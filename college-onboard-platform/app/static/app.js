// Global App State
let currentUser = null;
let currentRole = null; // 'candidate', 'hr', or 'admin'
let systemState = null;
let pollInterval = null;
let editingSeating = {};

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const portalScreen = document.getElementById('portal-screen');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const roleBadge = document.getElementById('role-badge');
const userDisplayName = document.getElementById('user-display-name');
const logoutBtn = document.getElementById('logout-btn');

// Sidebars & layout columns
const announcementsSidebar = document.getElementById('announcements-sidebar');

// Menu Groups
const candidateMenu = document.getElementById('candidate-menu');
const hrMenu = document.getElementById('hr-menu');
const adminMenu = document.getElementById('admin-menu');

// Profile Header Sidebar
const sidebarName = document.getElementById('sidebar-name');
const sidebarEmail = document.getElementById('sidebar-email');

// Handle Login Form Submit
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    authenticate(username, password);
});

async function authenticate(username, password) {
    // 1. Fetch current database state to check user credentials
    try {
        const res = await fetch('/api/state');
        const state = await res.json();
        systemState = state;

        let authenticated = false;
        let role = null;
        let userData = null;

        // Check defaults first
        if (username === 'admin' && password === 'password') {
            authenticated = true;
            role = 'admin';
            userData = { name: 'PES Chairperson', email: 'chairperson@pes.edu' };
        } else if (username === 'hr' && password === 'password') {
            authenticated = true;
            role = 'hr';
            userData = { name: 'HR Desk Officer', email: 'hr.onboarding@pes.edu' };
        } else if (state.teachers && state.teachers[username]) {
            const teacher = state.teachers[username];
            if (teacher.password === password) {
                authenticated = true;
                role = 'candidate';
                userData = teacher;
            }
        }

        if (!authenticated) {
            alert('Invalid credentials. Please refer to login hint below the card.');
            return;
        }

        // Setup session
        currentUser = username;
        currentRole = role;

        // Visual routing transformations
        loginScreen.classList.add('hidden');
        portalScreen.classList.remove('hidden');

        // Render menus based on role
        candidateMenu.classList.add('hidden');
        hrMenu.classList.add('hidden');
        adminMenu.classList.add('hidden');

        if (role === 'candidate') {
            candidateMenu.classList.remove('hidden');
            roleBadge.innerText = 'Candidate / Teacher';
            roleBadge.className = 'badge badge-info';
            announcementsSidebar.classList.remove('hidden');
            // Trigger default tab
            switchTab('candidate-profile');
        } else if (role === 'hr') {
            hrMenu.classList.remove('hidden');
            roleBadge.innerText = 'HR Department';
            roleBadge.className = 'badge badge-success';
            announcementsSidebar.classList.add('hidden');
            switchTab('hr-teachers-list');
        } else if (role === 'admin') {
            adminMenu.classList.remove('hidden');
            roleBadge.innerText = 'Chairperson / Admin';
            roleBadge.className = 'badge badge-danger';
            announcementsSidebar.classList.remove('hidden');
            switchTab('admin-seating-allotment');
        }

        // Set sidebar user details
        sidebarName.innerText = userData.name;
        sidebarEmail.innerText = userData.email;
        userDisplayName.innerText = userData.name;

        // Update chatbot heading
        const chatbotHeading = document.getElementById('chatbot-heading');
        if (chatbotHeading) {
            chatbotHeading.innerText = `Hello ${userData.name}, how can I help you today?`;
        }

        // Render data values
        updateDashboardView();

        // Start real-time polling
        clearInterval(pollInterval);
        pollInterval = setInterval(syncStateData, 3000);

    } catch (e) {
        console.error(e);
        alert('Server communication error. Make sure the uvicorn server is running.');
    }
}

// Sign Out
logoutBtn.addEventListener('click', () => {
    currentUser = null;
    currentRole = null;
    portalScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    usernameInput.value = '';
    passwordInput.value = '';
    clearInterval(pollInterval);

    // Clear chatbot history
    const fsChatBody = document.getElementById('fullscreen-chat-body');
    if (fsChatBody) {
        fsChatBody.innerHTML = `
            <div class="chat-message bot">
                Ask me anything about PES
            </div>
        `;
    }
    const fsChatInput = document.getElementById('fullscreen-chat-input');
    if (fsChatInput) {
        fsChatInput.value = '';
    }
});

// Periodic Synchronization
async function syncStateData() {
    try {
        const res = await fetch('/api/state');
        systemState = await res.json();
        updateDashboardView();
    } catch (e) {
        console.error('Sync failed', e);
    }
}

// Tab switcher handler
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        const btn = e.target.closest('.nav-tab');
        if (!btn) return;
        const targetTab = btn.getAttribute('data-tab');
        switchTab(targetTab);
        
        if (targetTab === 'candidate-chatbot') {
            const teacher = (systemState.teachers && systemState.teachers[currentUser]) ? systemState.teachers[currentUser] : null;
            if (teacher && teacher.current_stage === 'policy_review') {
                const hasClickedAlert = localStorage.getItem(`has_clicked_policy_alert_${currentUser}`) === 'true';
                if (!hasClickedAlert) {
                    localStorage.setItem(`has_clicked_policy_alert_${currentUser}`, 'true');
                    btn.classList.remove('blinking-alert');
                    sendHiddenPolicyQuery();
                }
            }
        }
    });
});

function switchTab(tabId) {
    // Deactivate current tabs
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.add('hidden'));

    // Activate selected
    const activeTabButton = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
    if (activeTabButton) activeTabButton.classList.add('active');

    const targetPane = document.getElementById(`tab-${tabId}`);
    if (targetPane) targetPane.classList.remove('hidden');
}

// Update DOM elements using loaded state
function updateDashboardView() {
    if (!systemState) return;

    // Sidebar Blinking Alert for Candidate's Chatbot Tab
    const teacher = (systemState.teachers && systemState.teachers[currentUser]) ? systemState.teachers[currentUser] : null;
    const chatbotTab = document.querySelector('.nav-tab[data-tab="candidate-chatbot"]');
    if (teacher && currentRole === 'candidate') {
        const currentStage = teacher.current_stage || 'document_collection';
        const hasClickedAlert = localStorage.getItem(`has_clicked_policy_alert_${currentUser}`) === 'true';
        if (currentStage === 'policy_review' && !hasClickedAlert) {
            if (chatbotTab) {
                chatbotTab.classList.add('blinking-alert');
            }
        } else {
            if (chatbotTab) {
                chatbotTab.classList.remove('blinking-alert');
            }
        }
    } else {
        if (chatbotTab) {
            chatbotTab.classList.remove('blinking-alert');
        }
    }

    // Update chatbot heading for logged-in user
    const chatbotHeading = document.getElementById('chatbot-heading');
    if (chatbotHeading && userDisplayName && userDisplayName.innerText) {
        chatbotHeading.innerText = `Hello ${userDisplayName.innerText}, how can I help you today?`;
    }

    // 1. Render Announcements right panel
    const annListView = document.getElementById('announcements-list-view');
    annListView.innerHTML = '';
    const sortedAnn = [...systemState.announcements].reverse();
    sortedAnn.forEach(ann => {
        const annDiv = document.createElement('div');
        annDiv.className = 'ann-item';
        
        let actionButtons = '';
        if (currentRole === 'admin') {
            actionButtons = `
                <div class="ann-actions" style="display: flex; gap: 6px;">
                    <button class="btn btn-secondary btn-sm" onclick="editAnnouncement(${ann.id}, '${ann.title.replace(/'/g, "\\'")}', '${ann.content.replace(/'/g, "\\'")}')" title="Edit Announcement" style="padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; display: inline-flex; align-items: center; justify-content: center;">✏️</button>
                    <button class="btn btn-secondary btn-sm" onclick="deleteAnnouncement(${ann.id})" title="Delete Announcement" style="padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; display: inline-flex; align-items: center; justify-content: center; color: #ff6b6b; border-color: rgba(255, 107, 107, 0.2);">🗑️</button>
                </div>
            `;
        }

        annDiv.innerHTML = `
            <h4>${ann.title}</h4>
            <p>${ann.content}</p>
            <div class="ann-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem;">
                <div class="ann-meta" style="margin-top: 0; display: flex; gap: 1.5rem; justify-content: space-between; flex-grow: 1; margin-right: 1.5rem;">
                    <span>By: ${ann.sender}</span>
                    <span>Date: ${ann.date}</span>
                </div>
                ${actionButtons}
            </div>
        `;
        annListView.appendChild(annDiv);
    });

    // 2. Load candidate specific panels if Candidate is active
    if (currentRole === 'candidate' && systemState.teachers[currentUser]) {
        const teacher = systemState.teachers[currentUser];

        // Profile
        document.getElementById('prof-name').innerText = teacher.name;
        document.getElementById('prof-email').innerText = teacher.email;
        document.getElementById('prof-dept').innerText = teacher.department;
        document.getElementById('prof-desig').innerText = teacher.designation;
        document.getElementById('prof-leaves').innerText = teacher.leave_balance;
        const profEmpid = document.getElementById('prof-empid');
        if (profEmpid) {
            profEmpid.innerText = teacher.employee_id || 'Not Assigned';
        }

        // Onboarding Status
        const statusVal = document.getElementById('onboarding-status-val');
        const statusContainer = document.getElementById('onboarding-status-container');
        if (statusVal && statusContainer) {
            const msg = teacher.onboarding_status_message || 'Please upload documents in document upload tab';
            statusVal.innerText = msg;

            if (msg.toLowerCase().includes('verified')) {
                statusContainer.style.border = '1px solid rgba(86, 211, 100, 0.3)';
                statusContainer.style.background = 'rgba(86, 211, 100, 0.02)';
            } else if (msg.toLowerCase().includes('rejected')) {
                statusContainer.style.border = '1px solid rgba(248, 81, 73, 0.3)';
                statusContainer.style.background = 'rgba(248, 81, 73, 0.02)';
            } else {
                statusContainer.style.border = '1px solid rgba(210, 153, 34, 0.3)';
                statusContainer.style.background = 'rgba(210, 153, 34, 0.02)';
            }
        }

        // Seating Info
        const seatVal = document.getElementById('seating-allocated-val');
        seatVal.innerText = teacher.seating_info || 'Not Allotted';

        // Calendar Schedule
        const scheduleBody = document.getElementById('calendar-schedule-body');
        scheduleBody.innerHTML = '';
        if (teacher.schedule && teacher.schedule.length > 0) {
            teacher.schedule.forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${s.day}</strong></td>
                    <td>${s.time}</td>
                    <td>${s.subject}</td>
                    <td><span class="badge badge-info">${s.class}</span></td>
                `;
                scheduleBody.appendChild(tr);
            });
        } else {
            scheduleBody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">No classes scheduled</td></tr>';
        }

        // Attendance Record
        const absentCount = document.getElementById('attendance-absent-count');
        absentCount.innerText = teacher.attendance ? teacher.attendance.length : 0;

        const attendanceBody = document.getElementById('attendance-record-body');
        attendanceBody.innerHTML = '';
        if (teacher.attendance && teacher.attendance.length > 0) {
            teacher.attendance.forEach(att => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${att.date}</td>
                    <td><span class="badge badge-danger">${att.status}</span></td>
                    <td>${att.reason}</td>
                `;
                attendanceBody.appendChild(tr);
            });
        } else {
            attendanceBody.innerHTML = '<tr><td colspan="3" class="text-muted text-center">Perfect attendance record</td></tr>';
        }

        // Handle staged/submitted documents view
        const cardAadhaar = document.getElementById('card-aadhaar');
        const cardAppointment = document.getElementById('card-appointment');
        const cardTet = document.getElementById('card-tet');
        const statusAadhaar = document.getElementById('status-aadhaar');
        const statusAppointment = document.getElementById('status-appointment');
        const statusTet = document.getElementById('status-tet');
        const batchSubmitBtn = document.getElementById('batch-submit-btn');

        if (cardAadhaar || cardAppointment || cardTet) {
            const statuses = teacher.document_statuses || {
                aadhaar_card: "unuploaded",
                appointment_letter: "unuploaded",
                teacher_eligibility_test: "unuploaded"
            };
            const paths = teacher.document_paths || {
                aadhaar_card: "",
                appointment_letter: "",
                teacher_eligibility_test: ""
            };

            function renderTeacherDoc(card, statusElem, docKey) {
                if (!card || !statusElem) return;
                const status = statuses[docKey];
                const path = paths[docKey];
                const fileInput = card.querySelector('input[type="file"]');
                const dropArea = card.querySelector('.upload-zone-droparea') || card;
                const button = card.querySelector('.upload-btn-neat');

                if (status === 'pending' || status === 'approved') {
                    card.classList.add('staged');
                    const getFileName = (pathString) => {
                        if (!pathString) return 'File pending review';
                        try {
                            const parts = pathString.split('/');
                            return decodeURIComponent(parts[parts.length - 1]);
                        } catch(e) {
                            return pathString;
                        }
                    };
                    statusElem.innerText = getFileName(path);
                    dropArea.style.pointerEvents = 'none';
                    if (button) {
                        button.disabled = true;
                        button.innerHTML = `<span>${status === 'approved' ? 'Approved ✓' : 'Pending Review'}</span>`;
                        button.style.pointerEvents = 'none';
                    }
                } else {
                    card.classList.remove('staged');
                    dropArea.style.pointerEvents = 'auto';
                    if (button) {
                        button.disabled = false;
                        button.innerHTML = `<span>Choose PDF</span><span class="upload-btn-arrow">📤</span>`;
                        button.style.pointerEvents = 'auto';
                    }

                    if (status === 'rejected') {
                        statusElem.innerHTML = `<span style="color:#ff6b6b; font-weight:500;">Rejected. Please re-upload.</span>`;
                    } else {
                        if (fileInput && fileInput.files && fileInput.files.length > 0) {
                            card.classList.add('staged');
                            statusElem.innerText = fileInput.files[0].name;
                        } else {
                            statusElem.innerText = 'No file selected';
                        }
                    }
                }
            }

            renderTeacherDoc(cardAadhaar, statusAadhaar, 'aadhaar_card');
            renderTeacherDoc(cardAppointment, statusAppointment, 'appointment_letter');
            renderTeacherDoc(cardTet, statusTet, 'teacher_eligibility_test');
            updateSubmitButtonState();
        }

    }

    // 3. Render HR Views
    if (currentRole === 'hr') {
        const teachersListContainer = document.getElementById('hr-teachers-list-view');
        const editDrawer = document.getElementById('hr-edit-drawer');
        const tabHrTeachersList = document.getElementById('tab-hr-teachers-list');

        // Safely preserve the editDrawer in the DOM before container is cleared
        if (editDrawer && tabHrTeachersList && editDrawer.parentNode !== tabHrTeachersList) {
            tabHrTeachersList.appendChild(editDrawer);
        }

        if (teachersListContainer) teachersListContainer.innerHTML = '';

        const hrSearchInput = document.getElementById('hr-search-teacher');
        const hrQuery = hrSearchInput ? hrSearchInput.value.trim().toLowerCase() : '';

        let pendingTeachersCount = 0;

        const teachersArray = Object.keys(systemState.teachers).map(uname => {
            return { username: uname, ...systemState.teachers[uname] };
        });

        // Sort alphabetically by name (case-insensitive)
        teachersArray.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        });

        teachersArray.forEach(t => {
            // Count teachers waiting for verification
            const docStatuses = t.document_statuses || {};
            const docPaths = t.document_paths || {};
            let hasPending = false;
            for (const docType of ['aadhaar_card', 'appointment_letter', 'teacher_eligibility_test']) {
                if (docPaths[docType] && docStatuses[docType] === 'pending') {
                    hasPending = true;
                    break;
                }
            }
            if (hasPending) {
                pendingTeachersCount++;
            }

            const matchesQuery = !hrQuery || (t.employee_id && t.employee_id.toLowerCase().includes(hrQuery));

            if (teachersListContainer && matchesQuery) {
                const div = document.createElement('div');
                div.className = 'teacher-card-item';
                div.setAttribute('data-username', t.username);
                div.innerHTML = `
                    <div class="teacher-card-info">
                        <h4>${t.name} (@${t.username})</h4>
                        <p>${t.designation} - ${t.department}</p>
                        <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom: 2px;">Email: ${t.email || 'N/A'} | Emp ID: ${t.employee_id || 'None'}</p>
                        <p style="font-size:0.75rem; color:var(--text-muted)">Seating: ${t.seating_info}</p>
                    </div>
                    <button class="btn btn-secondary btn-sm edit-profile-btn" data-username="${t.username}">Edit Profile</button>
                `;
                // Trigger Edit profile click
                div.querySelector('.edit-profile-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditDrawer(t.username, div);
                });
                teachersListContainer.appendChild(div);
            }
        });

        // Restore editDrawer position if it was open
        if (editDrawer && !editDrawer.classList.contains('hidden') && teachersListContainer) {
            const activeUsername = document.getElementById('edit-username').value;
            if (activeUsername) {
                const activeCard = teachersListContainer.querySelector(`[data-username="${activeUsername}"]`);
                if (activeCard) {
                    activeCard.parentNode.insertBefore(editDrawer, activeCard.nextSibling);
                }
            }
        }

        // Update Verification Badge
        const hrVerificationTab = document.getElementById('hr-verification-tab');
        if (hrVerificationTab) {
            hrVerificationTab.innerHTML = `Verification [${pendingTeachersCount}]`;
        }

        // Render Verification Panel View
        const hrVerificationList = document.getElementById('hr-verification-list');
        if (hrVerificationList) {
            hrVerificationList.innerHTML = '';
            let hasAnyDocs = false;

            Object.keys(systemState.teachers).forEach(uname => {
                const t = systemState.teachers[uname];
                const docStatuses = t.document_statuses || {};
                const allVerified = docStatuses.aadhaar_card === 'approved' && 
                                    docStatuses.appointment_letter === 'approved' && 
                                    docStatuses.teacher_eligibility_test === 'approved';
                const hasUploadedDocs = t.document_paths && (t.document_paths.aadhaar_card || t.document_paths.appointment_letter || t.document_paths.teacher_eligibility_test);
                if (hasUploadedDocs && !allVerified) {
                    hasAnyDocs = true;
                    const sec = document.createElement('div');
                    sec.className = 'verification-teacher-section mt-3';

                    const aadhaarPath = t.document_paths?.aadhaar_card || '';
                    const appointmentPath = t.document_paths?.appointment_letter || '';
                    const tetPath = t.document_paths?.teacher_eligibility_test || '';

                    const getFileName = (path) => {
                        if (!path) return 'Not Uploaded';
                        try {
                            const parts = path.split('/');
                            return decodeURIComponent(parts[parts.length - 1]);
                        } catch(e) {
                            return path;
                        }
                    };

                    const aadhaar = getFileName(aadhaarPath);
                    const appointment = getFileName(appointmentPath);
                    const tet = getFileName(tetPath);

                    const verifiedDocs = t.verified_documents || [];
                    const isAadhaarVerified = verifiedDocs.includes(aadhaarPath) || verifiedDocs.includes(aadhaar);
                    const isAppointmentVerified = verifiedDocs.includes(appointmentPath) || verifiedDocs.includes(appointment);
                    const isTetVerified = verifiedDocs.includes(tetPath) || verifiedDocs.includes(tet);

                    sec.innerHTML = `
                        <div class="verification-teacher-header">${t.name} (@${t.username})</div>
                        <div class="verification-docs-grid">
                            <div class="verification-doc-card ${aadhaarPath ? 'uploaded' : ''}">
                                <div class="verification-doc-emoji">🪪</div>
                                <div class="verification-doc-title">Aadhaar Card</div>
                                <div class="verification-doc-file">${aadhaar}</div>
                                ${aadhaarPath ? `
                                    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px; width: 100%;">
                                        <button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 4px 6px;" onclick="viewDoc('${aadhaarPath}')">View</button>
                                        ${isAadhaarVerified ? `
                                            <button class="btn btn-success btn-sm" style="font-size: 0.75rem; padding: 4px 6px;" disabled>Approved ✓</button>
                                        ` : `
                                            <div style="display: flex; gap: 6px; width: 100%;">
                                                <button class="btn btn-primary btn-sm" style="flex: 1; font-size: 0.75rem; padding: 4px 6px;" onclick="verifyDoc('${t.username}', '${aadhaar}', 'aadhaar_card', true)">Approve</button>
                                                <button class="btn btn-danger btn-sm" style="flex: 1; font-size: 0.75rem; padding: 4px 6px;" onclick="verifyDoc('${t.username}', '${aadhaar}', 'aadhaar_card', false)">Reject</button>
                                            </div>
                                        `}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="verification-doc-card ${appointmentPath ? 'uploaded' : ''}">
                                <div class="verification-doc-emoji">📄</div>
                                <div class="verification-doc-title">Appointment Letter</div>
                                <div class="verification-doc-file">${appointment}</div>
                                ${appointmentPath ? `
                                    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px; width: 100%;">
                                        <button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 4px 6px;" onclick="viewDoc('${appointmentPath}')">View</button>
                                        ${isAppointmentVerified ? `
                                            <button class="btn btn-success btn-sm" style="font-size: 0.75rem; padding: 4px 6px;" disabled>Approved ✓</button>
                                        ` : `
                                            <div style="display: flex; gap: 6px; width: 100%;">
                                                <button class="btn btn-primary btn-sm" style="flex: 1; font-size: 0.75rem; padding: 4px 6px;" onclick="verifyDoc('${t.username}', '${appointment}', 'appointment_letter', true)">Approve</button>
                                                <button class="btn btn-danger btn-sm" style="flex: 1; font-size: 0.75rem; padding: 4px 6px;" onclick="verifyDoc('${t.username}', '${appointment}', 'appointment_letter', false)">Reject</button>
                                            </div>
                                        `}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="verification-doc-card ${tetPath ? 'uploaded' : ''}">
                                <div class="verification-doc-emoji">🎓</div>
                                <div class="verification-doc-title">Teacher Eligibility Test</div>
                                <div class="verification-doc-file">${tet}</div>
                                ${tetPath ? `
                                    <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px; width: 100%;">
                                        <button class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 4px 6px;" onclick="viewDoc('${tetPath}')">View</button>
                                        ${isTetVerified ? `
                                            <button class="btn btn-success btn-sm" style="font-size: 0.75rem; padding: 4px 6px;" disabled>Approved ✓</button>
                                        ` : `
                                            <div style="display: flex; gap: 6px; width: 100%;">
                                                <button class="btn btn-primary btn-sm" style="flex: 1; font-size: 0.75rem; padding: 4px 6px;" onclick="verifyDoc('${t.username}', '${tet}', 'teacher_eligibility_test', true)">Approve</button>
                                                <button class="btn btn-danger btn-sm" style="flex: 1; font-size: 0.75rem; padding: 4px 6px;" onclick="verifyDoc('${t.username}', '${tet}', 'teacher_eligibility_test', false)">Reject</button>
                                            </div>
                                        `}
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                    hrVerificationList.appendChild(sec);
                }
            });

            if (!hasAnyDocs) {
                hrVerificationList.innerHTML = '<p class="text-muted text-center mt-3">No pending documents to verify.</p>';
            }
        }
    }

    // 4. Render Admin / Chairperson Views
    if (currentRole === 'admin') {
        const unallottedTeachers = Object.values(systemState.teachers).filter(t => !t.seating_info || t.seating_info === 'Not Allotted');
        const unallottedCount = unallottedTeachers.length;

        // Render Sidebar badge
        const adminSeatingTab = document.querySelector('.nav-tab[data-tab="admin-seating-allotment"]');
        if (adminSeatingTab) {
            adminSeatingTab.innerHTML = `Allot Seating [${unallottedCount}]`;
        }

        // Render dynamic list of all teachers
        const adminSeatingList = document.getElementById('admin-seating-list');
        if (adminSeatingList) {
            const activeInput = document.activeElement;
            const isTextInput = activeInput && activeInput.tagName === 'INPUT';
            const hasFocus = isTextInput && adminSeatingList.contains(activeInput);
            if (!hasFocus) {
                adminSeatingList.innerHTML = '';
                const sortedSeatingTeachers = Object.values(systemState.teachers).sort((a, b) => {
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    if (nameA < nameB) return -1;
                    if (nameA > nameB) return 1;
                    return 0;
                });
                sortedSeatingTeachers.forEach(t => {
                    const isAllotted = t.seating_info && t.seating_info !== 'Not Allotted';
                    const isEditing = editingSeating[t.username] === true;

                    const card = document.createElement('div');
                    card.className = 'verification-teacher-section mt-3';

                    if (isAllotted && !isEditing) {
                        card.innerHTML = `
                            <div class="verification-teacher-header">${t.name} (@${t.username})</div>
                            <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; gap: 10px;">
                                <div><strong>Department:</strong> ${t.department}</div>
                                <div><strong>Designation:</strong> ${t.designation}</div>
                                <div style="display: flex; gap: 15px; align-items: center; margin-top: 10px; background: rgba(88,166,255,0.05); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(88,166,255,0.15);">
                                    <span style="font-size: 0.85rem; flex: 1;">📍 Seating: <strong style="color: #58a6ff;">${t.seating_info}</strong></span>
                                    <button class="btn btn-secondary btn-sm" style="padding: 4px 12px;" onclick="enableSeatingEdit('${t.username}')">Edit</button>
                                </div>
                            </div>
                        `;
                    } else {
                        card.innerHTML = `
                            <div class="verification-teacher-header">${t.name} (@${t.username})</div>
                            <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; gap: 10px;">
                                <div><strong>Department:</strong> ${t.department}</div>
                                <div><strong>Designation:</strong> ${t.designation}</div>
                                <div style="display: flex; gap: 10px; align-items: center; margin-top: 10px;">
                                    <input type="text" id="seating-input-${t.username}" class="form-control" style="flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 8px 12px; border-radius: 6px;" placeholder="e.g. Room 402, Desk A" value="${isAllotted ? t.seating_info : ''}" required>
                                    <button class="btn btn-primary btn-sm" style="padding: 8px 16px;" onclick="allocateSeating('${t.username}')">Allocate Space</button>
                                </div>
                            </div>
                        `;
                    }
                    adminSeatingList.appendChild(card);
                });
            }
        }

        // Populate admin teachers list overview table
        const adminTeachersTableBody = document.getElementById('admin-teachers-table-body');
        if (adminTeachersTableBody) {
            adminTeachersTableBody.innerHTML = '';
            const adminSearchInput = document.getElementById('admin-search-teacher');
            const adminQuery = adminSearchInput ? adminSearchInput.value.trim().toLowerCase() : '';

            const sortedOverviewTeachers = Object.values(systemState.teachers).sort((a, b) => {
                const nameA = (a.name || '').toLowerCase();
                const nameB = (b.name || '').toLowerCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;
                return 0;
            });
            sortedOverviewTeachers.forEach(t => {

                const matchesQuery = !adminQuery || (t.employee_id && t.employee_id.toLowerCase().includes(adminQuery));

                if (matchesQuery) {
                    let seatingHTML = 'Not Allotted';
                    if (t.seating_info && t.seating_info.includes(',')) {
                        const parts = t.seating_info.split(',');
                        seatingHTML = `<div style="font-weight:600; color:#fff">${parts[0].trim()}</div><div style="font-size:0.75rem; color:var(--text-secondary)">${parts[1].trim()}</div>`;
                    } else if (t.seating_info) {
                        seatingHTML = `<div style="font-weight:600; color:#fff">${t.seating_info}</div>`;
                    }

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td><strong>${t.name}</strong></td>
                        <td>${t.department}</td>
                        <td>${t.email}</td>
                        <td>${seatingHTML}</td>
                        <td>${t.documents ? t.documents.length : 0} file(s)</td>
                    `;
                    adminTeachersTableBody.appendChild(tr);
                }
            });
        }
    }
}

// HR Add Teacher Form
const hrAddTeacherForm = document.getElementById('hr-add-teacher-form');
hrAddTeacherForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        name: document.getElementById('add-name').value,
        email: document.getElementById('add-email').value,
        department: document.getElementById('add-dept').value,
        designation: document.getElementById('add-desig').value,
        employee_id: document.getElementById('add-empid').value.trim()
    };

    const tempUsername = payload.email;
    const originalTeachers = { ...systemState.teachers };
    systemState.teachers[tempUsername] = {
        name: payload.name,
        email: payload.email,
        department: payload.department,
        designation: payload.designation,
        username: tempUsername,
        employee_id: payload.employee_id,
        documents: [],
        document_statuses: {},
        document_paths: {},
        seating_info: 'Not Allotted',
        current_stage: 'document_submission',
        onboarding_status_message: 'Registered, awaiting document submission'
    };

    // Optimistic Update
    updateDashboardView();
    hrAddTeacherForm.reset();
    switchTab('hr-teachers-list');

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add_teacher', payload })
        });

        if (!res.ok) {
            // Rollback
            systemState.teachers = originalTeachers;
            updateDashboardView();
            const err = await res.json();
            alert(`Error: ${err.detail}`);
        } else {
            syncStateData();
        }
    } catch (e) {
        // Rollback
        systemState.teachers = originalTeachers;
        updateDashboardView();
        alert('Server communication error.');
    }
});

window.viewDoc = function(docName) {
    if (docName && (docName.startsWith('http://') || docName.startsWith('https://') || docName.startsWith('/static/uploads/'))) {
        window.open(docName, "_blank");
        return;
    }
    const win = window.open("", "_blank");
    win.document.write(`
        <html>
        <head>
            <title>Preview: ${docName}</title>
            <style>
                body { background: #0d1117; color: #c9d1d9; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .container { border: 1px solid #30363d; padding: 2rem; border-radius: 8px; background: #161b22; text-align: center; max-width: 500px; }
                h2 { color: #58a6ff; }
                p { color: #8b949e; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Document Preview</h2>
                <p><strong>File Name:</strong> ${docName}</p>
                <p style="font-size: 0.9rem;">This is a simulated verification view for administrative preview of the submitted PDF asset.</p>
                <button onclick="window.close()" style="background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; margin-top: 1rem;">Close Preview</button>
            </div>
        </body>
        </html>
    `);
};

window.verifyDoc = async function(username, docName, docType, approved) {
    const teacher = systemState.teachers[username];
    if (!teacher) return;

    // Save original state
    const originalStatus = { ...teacher.document_statuses };
    const originalStage = teacher.current_stage;
    const originalMessage = teacher.onboarding_status_message;

    // Optimistic Update
    teacher.document_statuses[docType] = approved ? 'approved' : 'rejected';
    updateDashboardView();

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'verify_document',
                payload: { username, document_name: docName, doc_type: docType, approved: approved }
            })
        });
        if (!res.ok) {
            // Rollback
            teacher.document_statuses = originalStatus;
            teacher.current_stage = originalStage;
            teacher.onboarding_status_message = originalMessage;
            updateDashboardView();
            alert('Failed to evaluate document');
        } else {
            syncStateData();
        }
    } catch(err) {
        // Rollback
        teacher.document_statuses = originalStatus;
        teacher.current_stage = originalStage;
        teacher.onboarding_status_message = originalMessage;
        updateDashboardView();
        alert('Server communication error.');
    }
};

window.editAnnouncement = function(id, currentTitle, currentContent) {
    document.getElementById('edit-ann-id').value = id;
    document.getElementById('edit-ann-title').value = currentTitle;
    document.getElementById('edit-ann-content').value = currentContent;
    document.getElementById('admin-edit-announcement-modal').classList.remove('hidden');
};

// Edit Announcement Modal Event Listeners
document.getElementById('close-ann-modal-btn').addEventListener('click', () => {
    document.getElementById('admin-edit-announcement-modal').classList.add('hidden');
});

document.getElementById('admin-edit-announcement-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('admin-edit-announcement-modal')) {
        document.getElementById('admin-edit-announcement-modal').classList.add('hidden');
    }
});

document.getElementById('admin-edit-announcement-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = parseInt(document.getElementById('edit-ann-id').value);
    const newTitle = document.getElementById('edit-ann-title').value;
    const newContent = document.getElementById('edit-ann-content').value;

    const originalAnnouncements = [...systemState.announcements];
    const annIdx = systemState.announcements.findIndex(ann => ann.id === id);
    if (annIdx !== -1) {
        systemState.announcements[annIdx].title = newTitle;
        systemState.announcements[annIdx].content = newContent;
    }

    // Optimistic Update
    updateDashboardView();
    document.getElementById('admin-edit-announcement-modal').classList.add('hidden');
    
    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'edit_announcement',
                payload: { id: id, title: newTitle, content: newContent }
            })
        });
        if (!res.ok) {
            // Rollback
            systemState.announcements = originalAnnouncements;
            updateDashboardView();
            alert('Failed to update announcement.');
        } else {
            syncStateData();
        }
    } catch(err) {
        // Rollback
        systemState.announcements = originalAnnouncements;
        updateDashboardView();
        alert('Server communication error.');
    }
});

window.deleteAnnouncement = async function(id) {
    if (!confirm("Are you sure you want to delete this announcement?")) return;
    
    const originalAnnouncements = [...systemState.announcements];
    systemState.announcements = systemState.announcements.filter(ann => ann.id !== id);

    // Optimistic Update
    updateDashboardView();

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'delete_announcement',
                payload: { id: id }
            })
        });
        if (!res.ok) {
            // Rollback
            systemState.announcements = originalAnnouncements;
            updateDashboardView();
            alert('Failed to delete announcement.');
        } else {
            syncStateData();
        }
    } catch(err) {
        // Rollback
        systemState.announcements = originalAnnouncements;
        updateDashboardView();
        alert('Server communication error.');
    }
};

// Open edit drawer helper
const editDrawer = document.getElementById('hr-edit-drawer');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
closeDrawerBtn.addEventListener('click', () => editDrawer.classList.add('hidden'));

function openEditDrawer(username, cardElement) {
    const t = systemState.teachers[username];
    if (!t) return;

    // Move editDrawer right after the teacher's card element in the DOM
    if (cardElement && editDrawer) {
        cardElement.parentNode.insertBefore(editDrawer, cardElement.nextSibling);
    }

    document.getElementById('edit-username').value = username;
    document.getElementById('edit-name').value = t.name;
    document.getElementById('edit-email').value = t.email;
    document.getElementById('edit-dept').value = t.department;
    document.getElementById('edit-desig').value = t.designation;
    document.getElementById('edit-empid').value = t.employee_id || '';

    editDrawer.classList.remove('hidden');
}

// Edit Form Submit
const hrEditForm = document.getElementById('hr-edit-form');
hrEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('edit-username').value;
    const payload = {
        username: username,
        name: document.getElementById('edit-name').value,
        email: document.getElementById('edit-email').value,
        department: document.getElementById('edit-dept').value,
        designation: document.getElementById('edit-desig').value,
        employee_id: document.getElementById('edit-empid').value.trim()
    };

    const originalTeacher = { ...systemState.teachers[username] };
    const originalTeachers = { ...systemState.teachers };

    // Optimistic Update
    systemState.teachers[username].name = payload.name;
    systemState.teachers[username].email = payload.email;
    systemState.teachers[username].department = payload.department;
    systemState.teachers[username].designation = payload.designation;
    systemState.teachers[username].employee_id = payload.employee_id;
    updateDashboardView();
    editDrawer.classList.add('hidden');

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_teacher', payload })
        });

        if (!res.ok) {
            // Rollback
            systemState.teachers[username] = originalTeacher;
            updateDashboardView();
            const err = await res.json();
            alert(`Error: ${err.detail}`);
        } else {
            syncStateData();
        }
    } catch (e) {
        // Rollback
        systemState.teachers = originalTeachers;
        updateDashboardView();
        alert('Server communication error.');
    }
});

// Delete Teacher Profile Action
const deleteTeacherBtn = document.getElementById('delete-teacher-btn');
deleteTeacherBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const username = document.getElementById('edit-username').value;
    if (!username) return;

    if (confirm(`Are you sure you want to permanently delete the profile for @${username}?`)) {
        const originalTeachers = { ...systemState.teachers };

        // Optimistic Update
        delete systemState.teachers[username];
        updateDashboardView();
        editDrawer.classList.add('hidden');

        try {
            const res = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_teacher',
                    payload: { username }
                })
            });

            if (!res.ok) {
                // Rollback
                systemState.teachers = originalTeachers;
                updateDashboardView();
                const err = await res.json();
                alert(`Error: ${err.detail}`);
            } else {
                syncStateData();
            }
        } catch (e) {
            // Rollback
            systemState.teachers = originalTeachers;
            updateDashboardView();
            alert('Server communication error.');
        }
    }
});

// Candidate batch document upload action
const fileAadhaar = document.getElementById('file-aadhaar');
const fileAppointment = document.getElementById('file-appointment');
const fileTet = document.getElementById('file-tet');
const batchSubmitBtn = document.getElementById('batch-submit-btn');

function updateSubmitButtonState() {
    if (!batchSubmitBtn) return;

    // Fetch statuses from teacher data in systemState
    const teacher = (systemState.teachers && systemState.teachers[currentUser]) ? systemState.teachers[currentUser] : {};
    const statuses = teacher.document_statuses || {};

    const aadhaarReady = (statuses['aadhaar_card'] === 'pending' || statuses['aadhaar_card'] === 'approved') || 
                         (fileAadhaar && fileAadhaar.files && fileAadhaar.files.length > 0);
                         
    const appointmentReady = (statuses['appointment_letter'] === 'pending' || statuses['appointment_letter'] === 'approved') || 
                             (fileAppointment && fileAppointment.files && fileAppointment.files.length > 0);
                             
    const tetReady = (statuses['teacher_eligibility_test'] === 'pending' || statuses['teacher_eligibility_test'] === 'approved') || 
                     (fileTet && fileTet.files && fileTet.files.length > 0);

    const hasNewAadhaar = fileAadhaar && fileAadhaar.files && fileAadhaar.files.length > 0;
    const hasNewAppointment = fileAppointment && fileAppointment.files && fileAppointment.files.length > 0;
    const hasNewTet = fileTet && fileTet.files && fileTet.files.length > 0;

    const hasAnyNewFile = hasNewAadhaar || hasNewAppointment || hasNewTet;
    const allThreeReady = aadhaarReady && appointmentReady && tetReady;

    if (allThreeReady && hasAnyNewFile) {
        batchSubmitBtn.disabled = false;
        batchSubmitBtn.innerText = 'Submit';
    } else {
        batchSubmitBtn.disabled = true;
        
        // If all three documents are already successfully uploaded and pending/approved
        const allSubmitted = (statuses['aadhaar_card'] === 'pending' || statuses['aadhaar_card'] === 'approved') &&
                             (statuses['appointment_letter'] === 'pending' || statuses['appointment_letter'] === 'approved') &&
                             (statuses['teacher_eligibility_test'] === 'pending' || statuses['teacher_eligibility_test'] === 'approved');
        if (allSubmitted) {
            batchSubmitBtn.innerText = 'Submitted';
        } else {
            batchSubmitBtn.innerText = 'Submit';
        }
    }
}

if (fileAadhaar) {
    const card = document.getElementById('card-aadhaar');
    const button = card ? card.querySelector('.upload-btn-neat') : null;
    if (button) {
        button.addEventListener('click', (e) => {
            const teacher = (systemState.teachers && systemState.teachers[currentUser]) ? systemState.teachers[currentUser] : {};
            const statuses = teacher.document_statuses || {};
            const status = statuses['aadhaar_card'];
            if (status === 'pending' || status === 'approved') {
                e.preventDefault();
                return;
            }
            fileAadhaar.click();
        });
    }
    fileAadhaar.addEventListener('change', () => {
        const status = document.getElementById('status-aadhaar');
        if (fileAadhaar.files.length > 0) {
            if (card) card.classList.add('staged');
            if (status) status.innerText = fileAadhaar.files[0].name;
        } else {
            if (card) card.classList.remove('staged');
            if (status) status.innerText = 'No file selected';
        }
        updateSubmitButtonState();
    });
}
if (fileAppointment) {
    const card = document.getElementById('card-appointment');
    const button = card ? card.querySelector('.upload-btn-neat') : null;
    if (button) {
        button.addEventListener('click', (e) => {
            const teacher = (systemState.teachers && systemState.teachers[currentUser]) ? systemState.teachers[currentUser] : {};
            const statuses = teacher.document_statuses || {};
            const status = statuses['appointment_letter'];
            if (status === 'pending' || status === 'approved') {
                e.preventDefault();
                return;
            }
            fileAppointment.click();
        });
    }
    fileAppointment.addEventListener('change', () => {
        const status = document.getElementById('status-appointment');
        if (fileAppointment.files.length > 0) {
            if (card) card.classList.add('staged');
            if (status) status.innerText = fileAppointment.files[0].name;
        } else {
            if (card) card.classList.remove('staged');
            if (status) status.innerText = 'No file selected';
        }
        updateSubmitButtonState();
    });
}
if (fileTet) {
    const card = document.getElementById('card-tet');
    const button = card ? card.querySelector('.upload-btn-neat') : null;
    if (button) {
        button.addEventListener('click', (e) => {
            const teacher = (systemState.teachers && systemState.teachers[currentUser]) ? systemState.teachers[currentUser] : {};
            const statuses = teacher.document_statuses || {};
            const status = statuses['teacher_eligibility_test'];
            if (status === 'pending' || status === 'approved') {
                e.preventDefault();
                return;
            }
            fileTet.click();
        });
    }
    fileTet.addEventListener('change', () => {
        const status = document.getElementById('status-tet');
        if (fileTet.files.length > 0) {
            if (card) card.classList.add('staged');
            if (status) status.innerText = fileTet.files[0].name;
        } else {
            if (card) card.classList.remove('staged');
            if (status) status.innerText = 'No file selected';
        }
        updateSubmitButtonState();
    });
}

if (batchSubmitBtn) {
    batchSubmitBtn.addEventListener('click', async () => {
        const filesToUpload = [];
        if (fileAadhaar && fileAadhaar.files && fileAadhaar.files.length > 0) {
            filesToUpload.push({ file: fileAadhaar.files[0], type: 'aadhaar_card' });
        }
        if (fileAppointment && fileAppointment.files && fileAppointment.files.length > 0) {
            filesToUpload.push({ file: fileAppointment.files[0], type: 'appointment_letter' });
        }
        if (fileTet && fileTet.files && fileTet.files.length > 0) {
            filesToUpload.push({ file: fileTet.files[0], type: 'teacher_eligibility_test' });
        }

        if (filesToUpload.length === 0) return;

        // Save original state for rollback
        const originalTeacher = JSON.parse(JSON.stringify(systemState.teachers[currentUser]));

        // Optimistic Update
        const t = systemState.teachers[currentUser];
        if (!t.documents) t.documents = [];
        if (!t.document_statuses) t.document_statuses = {};
        if (!t.document_paths) t.document_paths = {};

        filesToUpload.forEach(item => {
            if (!t.documents.includes(item.file.name)) {
                t.documents.push(item.file.name);
            }
            t.document_statuses[item.type] = 'pending';
            t.document_paths[item.type] = item.file.name;
        });
        t.onboarding_status_message = 'Pending verification by HR';
        
        // Re-render UI immediately
        updateDashboardView();

        // Clear the input fields so they don't count as "newly staged" anymore
        if (fileAadhaar) fileAadhaar.value = '';
        if (fileAppointment) fileAppointment.value = '';
        if (fileTet) fileTet.value = '';
        updateSubmitButtonState();

        // Background Upload
        (async () => {
            try {
                let success = true;
                for (const item of filesToUpload) {
                    const formData = new FormData();
                    formData.append("file", item.file);
                    formData.append("doc_type", item.type);
                    formData.append("username", currentUser);

                    const res = await fetch('/api/upload', {
                        method: 'POST',
                        body: formData
                    });
                    if (!res.ok) success = false;
                }

                if (success) {
                    syncStateData();
                } else {
                    // Rollback
                    systemState.teachers[currentUser] = originalTeacher;
                    updateDashboardView();
                    alert('One or more document uploads failed.');
                    updateSubmitButtonState();
                }
            } catch (e) {
                // Rollback
                systemState.teachers[currentUser] = originalTeacher;
                updateDashboardView();
                alert('Server communication error during document upload.');
                updateSubmitButtonState();
            }
        })();
    });
}

// Dynamic Seating Allotment Trigger
window.allocateSeating = async function(username) {
    const input = document.getElementById(`seating-input-${username}`);
    if (!input || !input.value.trim()) {
        alert('Please enter seating coordinates.');
        return;
    }
    const newVal = input.value.trim();
    const originalSeating = systemState.teachers[username].seating_info;

    // Optimistic Update
    systemState.teachers[username].seating_info = newVal;
    editingSeating[username] = false; // Disable editing mode immediately
    if (input) input.blur();
    updateDashboardView();

    const payload = {
        username: username,
        seating_info: newVal
    };
    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'allot_seat', payload })
        });
        if (!res.ok) {
            // Rollback
            systemState.teachers[username].seating_info = originalSeating;
            editingSeating[username] = true;
            updateDashboardView();
            alert('Seat allotment failed.');
        } else {
            syncStateData();
        }
    } catch (e) {
        // Rollback
        systemState.teachers[username].seating_info = originalSeating;
        editingSeating[username] = true;
        updateDashboardView();
        alert('Server communication error.');
    }
};

window.enableSeatingEdit = function(username) {
    editingSeating[username] = true;
    updateDashboardView();
};

// Admin Announcement Form
const adminAnnouncementForm = document.getElementById('admin-announcement-form');
adminAnnouncementForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        title: document.getElementById('ann-title').value.trim(),
        content: document.getElementById('ann-content').value.trim(),
        sender: 'Admin'
    };

    const tempId = Date.now();
    const tempAnn = {
        id: tempId,
        title: payload.title,
        content: payload.content,
        sender: payload.sender,
        date: new Date().toISOString().split('T')[0]
    };

    // Save original state for rollback
    const originalAnnouncements = [...systemState.announcements];

    // Optimistic Update
    systemState.announcements.push(tempAnn);
    updateDashboardView();
    adminAnnouncementForm.reset();

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add_announcement', payload })
        });
        if (!res.ok) {
            // Rollback
            systemState.announcements = originalAnnouncements;
            updateDashboardView();
            alert('Announcement broadcast failed.');
        } else {
            syncStateData();
        }
    } catch (e) {
        // Rollback
        systemState.announcements = originalAnnouncements;
        updateDashboardView();
        alert('Server communication error.');
    }
});

// Full-screen Chatbot Interactivity
const fullscreenChatSend = document.getElementById('fullscreen-chat-send');
const fullscreenChatInput = document.getElementById('fullscreen-chat-input');
const fullscreenChatBody = document.getElementById('fullscreen-chat-body');

fullscreenChatSend.addEventListener('click', sendFullscreenChatMessage);
fullscreenChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendFullscreenChatMessage();
});

async function sendFullscreenChatMessage() {
    const text = fullscreenChatInput.value.trim();
    if (!text) return;

    appendFullscreenChatBubble('user', text);
    fullscreenChatInput.value = '';
    fullscreenChatBody.scrollTop = fullscreenChatBody.scrollHeight;

    // Show thinking indicator bubble
    const thinkingBubble = appendFullscreenChatBubble('bot', 'Thinking...');
    thinkingBubble.id = 'thinking-bubble';

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });

        // Remove thinking bubble
        const tb = document.getElementById('thinking-bubble');
        if (tb) tb.remove();

        const data = await res.json();
        appendFullscreenChatBubble('bot', data.response);
    } catch (e) {
        const tb = document.getElementById('thinking-bubble');
        if (tb) tb.remove();
        appendFullscreenChatBubble('bot', 'Error communicating with Pinecone RAG search agent.');
    }
    fullscreenChatBody.scrollTop = fullscreenChatBody.scrollHeight;
}

function formatMarkdown(text) {
    if (!text) return '';
    // Escape HTML first to prevent XSS
    let escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    // Convert double asterisks bold: **text** -> <strong>text</strong>
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Convert single asterisks bold: *text* -> <strong>text</strong>
    escaped = escaped.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    // Convert newlines to line breaks
    escaped = escaped.replace(/\n/g, '<br>');

    return escaped;
}

function appendFullscreenChatBubble(sender, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${sender}`;
    bubble.innerHTML = formatMarkdown(text);
    fullscreenChatBody.appendChild(bubble);
    return bubble;
}

async function sendHiddenPolicyQuery() {
    const thinkingBubble = appendFullscreenChatBubble('bot', 'Thinking...');
    thinkingBubble.id = 'thinking-bubble';

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'load_basic_policies_rag' })
        });

        const tb = document.getElementById('thinking-bubble');
        if (tb) tb.remove();

        const data = await res.json();
        appendFullscreenChatBubble('bot', data.response);
    } catch (e) {
        const tb = document.getElementById('thinking-bubble');
        if (tb) tb.remove();
        appendFullscreenChatBubble('bot', 'Error communicating with Pinecone RAG search agent.');
    }
    fullscreenChatBody.scrollTop = fullscreenChatBody.scrollHeight;
}

// Bind Real-time Search Filter Listeners
document.addEventListener('DOMContentLoaded', () => {
    const hrSearch = document.getElementById('hr-search-teacher');
    if (hrSearch) {
        hrSearch.addEventListener('input', () => {
            updateDashboardView();
        });
    }
    const adminSearch = document.getElementById('admin-search-teacher');
    if (adminSearch) {
        adminSearch.addEventListener('input', () => {
            updateDashboardView();
        });
    }
});
