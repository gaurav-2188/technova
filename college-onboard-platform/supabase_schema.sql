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
