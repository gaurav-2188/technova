-- SQL Schema script to create missing tables in Supabase
-- You can copy and run this in your Supabase SQL Editor console.

-- 1. Create the app_state table
CREATE TABLE IF NOT EXISTS public.app_state (
    id TEXT PRIMARY KEY,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create the meetings table
CREATE TABLE IF NOT EXISTS public.meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_date TEXT NOT NULL,
    event_time TEXT NOT NULL,
    departments TEXT[],
    department TEXT,
    created_at TEXT
);

-- 3. Create the timetable_classes table
CREATE TABLE IF NOT EXISTS public.timetable_classes (
    id TEXT PRIMARY KEY,
    subject_name TEXT NOT NULL,
    time_slot TEXT NOT NULL,
    classroom TEXT,
    day_of_week TEXT NOT NULL,
    created_at TEXT
);

-- Enable Row Level Security (RLS) or public access depending on your security preferences.
-- By default, if RLS is not set up, you may need to disable RLS or add policies:
ALTER TABLE public.app_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_classes DISABLE ROW LEVEL SECURITY;


-- ============================================================
-- RPC FUNCTION: process_daily_attendance
-- ============================================================
-- Processes a full-day Excel attendance upload atomically in the
-- database. Accepts a list of Employee IDs who are PRESENT today
-- and applies three rules to ALL teachers in the JSONB document:
--
--   Rule 1  PRESENT     : emp_id IN present_ids
--                         → present_days + 1
--
--   Rule 2  REGULAR ABS : emp_id NOT IN present_ids
--                         AND has an approved leave for target_date
--                         → absent_days + 1
--
--   Rule 3  LOSS OF PAY : emp_id NOT IN present_ids
--                         AND no approved leave for target_date
--                         → loss_of_pay_leaves + 1, absent_days + 1
--
-- Idempotent: any existing attendance entry for target_date is
-- removed before the new one is inserted, so re-uploading the
-- same day does not double-count. Counters are recomputed from
-- the full attendance array after each change.
--
-- Architecture note: The entire application state is stored as a
-- single JSONB document in app_state.state. This function does
-- JSONB surgery on that document — there are no separate relational
-- teacher/leave tables to JOIN against.
--
-- Run this in your Supabase SQL Editor to deploy the function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_daily_attendance(
    present_ids  TEXT[],
    target_date  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_state         JSONB;
    v_teachers      JSONB;
    v_new_teachers  JSONB;
    v_teacher_key   TEXT;
    v_teacher_val   JSONB;

    v_emp_id        TEXT;
    v_is_present    BOOLEAN;
    v_has_leave     BOOLEAN;
    v_leave_type    TEXT;

    v_old_att       JSONB;   -- attendance array with target_date entries removed
    v_new_record    JSONB;   -- new attendance entry for today
    v_new_att       JSONB;   -- full updated attendance array

    v_present_days  INT;
    v_absent_days   INT;
    v_lop_days      INT;

    v_updated_teacher JSONB;

    v_present_count INT := 0;
    v_absent_count  INT := 0;
    v_lop_count     INT := 0;
    v_total_count   INT := 0;

    v_summary       JSONB;
BEGIN
    -- ── Step 1: Lock the state row to prevent concurrent writes ──
    SELECT state
    INTO v_state
    FROM public.app_state
    WHERE id = 'main_state'
    FOR UPDATE;

    IF v_state IS NULL THEN
        RAISE EXCEPTION 'State not found in app_state table';
    END IF;

    v_teachers := v_state -> 'teachers';

    IF v_teachers IS NULL OR v_teachers = 'null'::jsonb THEN
        RAISE EXCEPTION 'No teachers found in state';
    END IF;

    -- ── Step 2: Build an updated teachers JSONB object ──
    -- We iterate every teacher, compute the right attendance action,
    -- recompute all three counters from the updated array, and
    -- accumulate the result with jsonb_object_agg.
    SELECT jsonb_object_agg(tk, tv)
    INTO v_new_teachers
    FROM (
        SELECT
            sub.teacher_key  AS tk,
            -- Merge the original teacher object with the recomputed fields
            sub.teacher_val
                || jsonb_build_object('present_days',      sub.present_days)
                || jsonb_build_object('absent_days',       sub.absent_days)
                || jsonb_build_object('loss_of_pay_leaves', sub.lop_days)
                || jsonb_build_object('attendance',        sub.new_att)
            AS tv
        FROM (
            SELECT
                e.key AS teacher_key,
                e.value AS teacher_val,

                -- ── Sanitize employee_id: strip whitespace, lowercase ──
                lower(
                    regexp_replace(
                        COALESCE(e.value ->> 'employee_id', ''),
                        '\s+', '', 'g'
                    )
                ) AS emp_id,

                -- ── Rule determination ──
                -- Is this teacher's emp_id in the present list?
                (
                    lower(
                        regexp_replace(
                            COALESCE(e.value ->> 'employee_id', ''),
                            '\s+', '', 'g'
                        )
                    ) <> ''
                    AND
                    lower(
                        regexp_replace(
                            COALESCE(e.value ->> 'employee_id', ''),
                            '\s+', '', 'g'
                        )
                    ) = ANY(
                        -- Sanitize the incoming present_ids array too
                        ARRAY(
                            SELECT lower(regexp_replace(x, '\s+', '', 'g'))
                            FROM unnest(present_ids) x
                        )
                    )
                ) AS is_present,

                -- Does this teacher have an approved leave on target_date?
                COALESCE(
                    (
                        SELECT true
                        FROM jsonb_array_elements(
                            COALESCE(e.value -> 'applied_leaves', '[]'::jsonb)
                        ) AS lv
                        WHERE lv ->> 'date'   = target_date
                          AND lv ->> 'status' = 'approved'
                        LIMIT 1
                    ),
                    false
                ) AS has_leave,

                -- What type of approved leave? (for the reason string)
                COALESCE(
                    (
                        SELECT lv ->> 'type'
                        FROM jsonb_array_elements(
                            COALESCE(e.value -> 'applied_leaves', '[]'::jsonb)
                        ) AS lv
                        WHERE lv ->> 'date'   = target_date
                          AND lv ->> 'status' = 'approved'
                        LIMIT 1
                    ),
                    'Leave'
                ) AS leave_type,

                -- ── Idempotency: remove existing entry for target_date ──
                COALESCE(
                    (
                        SELECT jsonb_agg(att)
                        FROM jsonb_array_elements(
                            COALESCE(e.value -> 'attendance', '[]'::jsonb)
                        ) AS att
                        WHERE att ->> 'date' <> target_date
                    ),
                    '[]'::jsonb
                ) AS stripped_att

            FROM jsonb_each(v_teachers) AS e(key, value)
        ) AS rules

        -- ── Build new attendance array and recompute counters ──
        CROSS JOIN LATERAL (
            SELECT
                CASE
                    WHEN rules.is_present THEN
                        jsonb_build_object(
                            'date',   target_date,
                            'status', 'Present',
                            'reason', 'Excel Parsed Present'
                        )
                    WHEN rules.has_leave THEN
                        jsonb_build_object(
                            'date',   target_date,
                            'status', 'Absent',
                            'reason', 'Regular Leave (' || rules.leave_type || ')'
                        )
                    ELSE
                        jsonb_build_object(
                            'date',   target_date,
                            'status', 'Absent',
                            'reason', 'Loss of Pay'
                        )
                END AS new_record
        ) AS rec

        CROSS JOIN LATERAL (
            -- Append the new record to the stripped array
            SELECT rules.stripped_att || jsonb_build_array(rec.new_record) AS new_att
        ) AS att_arr

        CROSS JOIN LATERAL (
            -- Recompute all three counters from the full updated array
            -- (prevents double-counting on idempotent re-uploads)
            SELECT
                COALESCE(
                    (SELECT count(*)::int FROM jsonb_array_elements(att_arr.new_att) x
                     WHERE x ->> 'status' = 'Present'),
                    0
                ) AS present_days,
                COALESCE(
                    (SELECT count(*)::int FROM jsonb_array_elements(att_arr.new_att) x
                     WHERE x ->> 'status' = 'Absent'),
                    0
                ) AS absent_days,
                COALESCE(
                    (SELECT count(*)::int FROM jsonb_array_elements(att_arr.new_att) x
                     WHERE x ->> 'status' = 'Absent'
                       AND x ->> 'reason' = 'Loss of Pay'),
                    0
                ) AS lop_days
        ) AS counters

    ) AS sub;

    -- ── Step 3: Atomic single UPDATE ──
    UPDATE public.app_state
    SET state = jsonb_set(
                    jsonb_set(v_state, '{teachers}', v_new_teachers),
                    '{last_updated}',
                    to_jsonb(extract(epoch FROM now()))
                )
    WHERE id = 'main_state';

    -- ── Step 4: Count results for the response summary ──
    SELECT
        COUNT(*) FILTER (
            WHERE (
                lower(regexp_replace(COALESCE(e.value ->> 'employee_id',''), '\s+','','g'))
                <> ''
                AND
                lower(regexp_replace(COALESCE(e.value ->> 'employee_id',''), '\s+','','g'))
                = ANY(ARRAY(SELECT lower(regexp_replace(x,'\s+','','g')) FROM unnest(present_ids) x))
            )
        )::int,
        COUNT(*) FILTER (
            WHERE NOT (
                lower(regexp_replace(COALESCE(e.value ->> 'employee_id',''), '\s+','','g'))
                <> ''
                AND
                lower(regexp_replace(COALESCE(e.value ->> 'employee_id',''), '\s+','','g'))
                = ANY(ARRAY(SELECT lower(regexp_replace(x,'\s+','','g')) FROM unnest(present_ids) x))
            )
        )::int,
        COUNT(*)::int
    INTO v_present_count, v_absent_count, v_total_count
    FROM jsonb_each(v_teachers) AS e(key, value);

    v_lop_count := (
        SELECT COUNT(*)::int
        FROM jsonb_each(v_teachers) AS e(key, value)
        WHERE NOT (
            lower(regexp_replace(COALESCE(e.value ->> 'employee_id',''), '\s+','','g')) <> ''
            AND
            lower(regexp_replace(COALESCE(e.value ->> 'employee_id',''), '\s+','','g'))
            = ANY(ARRAY(SELECT lower(regexp_replace(x,'\s+','','g')) FROM unnest(present_ids) x))
        )
        AND NOT COALESCE(
            (SELECT true
             FROM jsonb_array_elements(COALESCE(e.value -> 'applied_leaves', '[]'::jsonb)) lv
             WHERE lv->>'date' = target_date AND lv->>'status' = 'approved'
             LIMIT 1),
            false
        )
    );

    v_summary := jsonb_build_object(
        'status',             'success',
        'date',               target_date,
        'teachers_processed', v_total_count,
        'present_count',      v_present_count,
        'absent_count',       v_absent_count,
        'lop_count',          v_lop_count
    );

    RETURN v_summary;

EXCEPTION WHEN OTHERS THEN
    -- Roll back is automatic on exception in plpgsql
    RAISE EXCEPTION '[process_daily_attendance] Transaction failed: % %', SQLERRM, SQLSTATE;
END;
$$;

-- Grant execute permission to the service_role (used by Supabase Python client)
GRANT EXECUTE ON FUNCTION public.process_daily_attendance(TEXT[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_daily_attendance(TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_daily_attendance(TEXT[], TEXT) TO anon;


-- ============================================================
-- RPC FUNCTION: calculate_monthly_salary
-- ============================================================
-- READ-ONLY. Returns a JSONB array of per-teacher salary
-- breakdowns for the requested month (e.g. '2026-07').
--
-- Salary formula:
--   gross     = working_days * daily_rate
--   deduction = lop_days_this_month * daily_rate
--   net       = gross - deduction
--
-- working_days is read from app_state.state.global_working_days.
-- daily_rate defaults to 3400 if not present on the teacher object.
--
-- Does NOT modify any data. Safe to call multiple times.
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_monthly_salary(
    target_month TEXT   -- e.g. '2026-07'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_state          JSONB;
    v_teachers       JSONB;
    v_working_days   INT;
    v_results        JSONB := '[]'::jsonb;
BEGIN
    SELECT state INTO v_state
    FROM public.app_state
    WHERE id = 'main_state';

    IF v_state IS NULL THEN
        RAISE EXCEPTION 'State not found in app_state table';
    END IF;

    v_teachers     := v_state -> 'teachers';
    v_working_days := COALESCE((v_state ->> 'global_working_days')::int, 26);

    SELECT jsonb_agg(row_data ORDER BY row_data->>'name')
    INTO v_results
    FROM (
        SELECT
            jsonb_build_object(
                'username',       e.key,
                'name',           COALESCE(e.value->>'name', e.key),
                'employee_id',    COALESCE(e.value->>'employee_id', ''),
                'department',     COALESCE(e.value->>'department', ''),
                'working_days',   v_working_days,
                'daily_rate',     COALESCE((e.value->>'daily_rate')::numeric, 3400),
                'present_this_month', COALESCE(
                    (SELECT count(*)::int
                     FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                     WHERE (a->>'date') LIKE (target_month || '%')
                       AND (a->>'status') = 'Present'),
                    0
                ),
                'absent_this_month', COALESCE(
                    (SELECT count(*)::int
                     FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                     WHERE (a->>'date') LIKE (target_month || '%')
                       AND (a->>'status') = 'Absent'),
                    0
                ),
                'lop_this_month', COALESCE(
                    (SELECT count(*)::int
                     FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                     WHERE (a->>'date') LIKE (target_month || '%')
                       AND (a->>'status') = 'Absent'
                       AND (a->>'reason') = 'Loss of Pay'),
                    0
                ),
                'gross',          (v_working_days * COALESCE((e.value->>'daily_rate')::numeric, 3400)),
                'deduction',      (
                    COALESCE(
                        (SELECT count(*)::int
                         FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                         WHERE (a->>'date') LIKE (target_month || '%')
                           AND (a->>'status') = 'Absent'
                           AND (a->>'reason') = 'Loss of Pay'),
                        0
                    ) * COALESCE((e.value->>'daily_rate')::numeric, 3400)
                ),
                'net',            (
                    v_working_days * COALESCE((e.value->>'daily_rate')::numeric, 3400)
                    -
                    COALESCE(
                        (SELECT count(*)::int
                         FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                         WHERE (a->>'date') LIKE (target_month || '%')
                           AND (a->>'status') = 'Absent'
                           AND (a->>'reason') = 'Loss of Pay'),
                        0
                    ) * COALESCE((e.value->>'daily_rate')::numeric, 3400)
                ),
                'salary_pushed',  COALESCE(
                    (SELECT true
                     FROM jsonb_array_elements(COALESCE(e.value->'salary_history','[]'::jsonb)) h
                     WHERE (h->>'month_key') = target_month
                     LIMIT 1),
                    false
                )
            ) AS row_data
        FROM jsonb_each(v_teachers) AS e(key, value)
    ) AS rows;

    RETURN COALESCE(v_results, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_monthly_salary(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_salary(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_salary(TEXT) TO anon;


-- ============================================================
-- RPC FUNCTION: purge_old_attendance
-- ============================================================
-- Removes all daily attendance log entries older than cutoff_date
-- from every teacher's attendance[] array (to keep DB lean).
-- After purging, recomputes present_days, absent_days, and
-- loss_of_pay_leaves counters from the surviving records.
-- Performs a single atomic UPDATE on app_state.
--
-- Recommended: call with cutoff = today - 2 months.
-- Returns { deleted_count, cutoff_date, teachers_affected }.
-- ============================================================
CREATE OR REPLACE FUNCTION public.purge_old_attendance(
    cutoff_date TEXT   -- e.g. '2026-05-01' — entries BEFORE this date are deleted
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_state              JSONB;
    v_teachers           JSONB;
    v_new_teachers       JSONB;
    v_total_deleted      INT := 0;
    v_teachers_affected  INT := 0;
BEGIN
    -- Lock row for safe concurrent access
    SELECT state INTO v_state
    FROM public.app_state
    WHERE id = 'main_state'
    FOR UPDATE;

    IF v_state IS NULL THEN
        RAISE EXCEPTION 'State not found in app_state table';
    END IF;

    v_teachers := v_state -> 'teachers';

    -- Build updated teachers JSONB with old attendance stripped
    SELECT jsonb_object_agg(tk, tv)
    INTO v_new_teachers
    FROM (
        SELECT
            e.key AS tk,
            e.value
                || jsonb_build_object('attendance',        surv.surviving_att)
                || jsonb_build_object('present_days',      surv.present_days)
                || jsonb_build_object('absent_days',       surv.absent_days)
                || jsonb_build_object('loss_of_pay_leaves', surv.lop_days)
            AS tv,
            surv.deleted_count
        FROM jsonb_each(v_teachers) AS e(key, value)

        CROSS JOIN LATERAL (
            SELECT
                -- Keep only entries on or after cutoff_date
                COALESCE(
                    (SELECT jsonb_agg(a)
                     FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                     WHERE (a->>'date') >= cutoff_date),
                    '[]'::jsonb
                ) AS surviving_att,

                -- Count how many were removed
                COALESCE(
                    (SELECT count(*)::int
                     FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                     WHERE (a->>'date') < cutoff_date),
                    0
                ) AS deleted_count,

                -- Recompute counters from surviving records only
                COALESCE(
                    (SELECT count(*)::int
                     FROM jsonb_array_elements(
                         COALESCE(
                             (SELECT jsonb_agg(a)
                              FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                              WHERE (a->>'date') >= cutoff_date),
                             '[]'::jsonb
                         )
                     ) x WHERE (x->>'status') = 'Present'),
                    0
                ) AS present_days,

                COALESCE(
                    (SELECT count(*)::int
                     FROM jsonb_array_elements(
                         COALESCE(
                             (SELECT jsonb_agg(a)
                              FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                              WHERE (a->>'date') >= cutoff_date),
                             '[]'::jsonb
                         )
                     ) x WHERE (x->>'status') = 'Absent'),
                    0
                ) AS absent_days,

                COALESCE(
                    (SELECT count(*)::int
                     FROM jsonb_array_elements(
                         COALESCE(
                             (SELECT jsonb_agg(a)
                              FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                              WHERE (a->>'date') >= cutoff_date),
                             '[]'::jsonb
                         )
                     ) x WHERE (x->>'status') = 'Absent' AND (x->>'reason') = 'Loss of Pay'),
                    0
                ) AS lop_days
        ) AS surv
    ) AS sub;

    -- Count total deleted entries and teachers affected
    SELECT
        SUM(surv.deleted_count)::int,
        COUNT(*) FILTER (WHERE surv.deleted_count > 0)::int
    INTO v_total_deleted, v_teachers_affected
    FROM jsonb_each(v_teachers) AS e(key, value)
    CROSS JOIN LATERAL (
        SELECT
            COALESCE(
                (SELECT count(*)::int
                 FROM jsonb_array_elements(COALESCE(e.value->'attendance','[]'::jsonb)) a
                 WHERE (a->>'date') < cutoff_date),
                0
            ) AS deleted_count
    ) AS surv;

    -- Single atomic UPDATE
    UPDATE public.app_state
    SET state = jsonb_set(
                    jsonb_set(v_state, '{teachers}', v_new_teachers),
                    '{last_updated}',
                    to_jsonb(extract(epoch FROM now()))
                )
    WHERE id = 'main_state';

    RETURN jsonb_build_object(
        'status',            'success',
        'cutoff_date',       cutoff_date,
        'deleted_count',     v_total_deleted,
        'teachers_affected', v_teachers_affected
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '[purge_old_attendance] Transaction failed: % %', SQLERRM, SQLSTATE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_old_attendance(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_old_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_attendance(TEXT) TO anon;
