// Global App State
let currentUser = null;
let currentRole = null; // 'candidate', 'hr', or 'admin'
let systemState = null;
let pollInterval = null;
let editingSeating = {};
let isUploading = false;
window.isConfirming = false;

// Beautiful Custom Modal Dialog (Alert/Confirm) Helpers
window.showCustomAlert = function(title, message, icon = '⚠️') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-alert-modal');
        const iconEl = document.getElementById('custom-alert-icon');
        const titleEl = document.getElementById('custom-alert-title');
        const msgEl = document.getElementById('custom-alert-message');
        const okBtn = document.getElementById('custom-alert-ok');
        const cancelBtn = document.getElementById('custom-alert-cancel');
        
        iconEl.innerText = icon;
        titleEl.innerText = title;
        msgEl.innerText = message;
        cancelBtn.style.display = 'none';
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
        
        window.isConfirming = true;
        
        okBtn.onclick = () => {
            modal.style.display = 'none';
            modal.classList.add('hidden');
            window.isConfirming = false;
            resolve(true);
        };
    });
};

window.showCustomConfirm = function(title, message, icon = '❓') {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-alert-modal');
        const iconEl = document.getElementById('custom-alert-icon');
        const titleEl = document.getElementById('custom-alert-title');
        const msgEl = document.getElementById('custom-alert-message');
        const okBtn = document.getElementById('custom-alert-ok');
        const cancelBtn = document.getElementById('custom-alert-cancel');
        
        iconEl.innerText = icon;
        titleEl.innerText = title;
        msgEl.innerText = message;
        cancelBtn.style.display = 'block';
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
        
        window.isConfirming = true;
        
        okBtn.onclick = () => {
            modal.style.display = 'none';
            modal.classList.add('hidden');
            window.isConfirming = false;
            resolve(true);
        };
        
        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            modal.classList.add('hidden');
            window.isConfirming = false;
            resolve(false);
        };
    });
};

// Override native alert to use the beautiful custom HTML modal dialog
window.alert = function(msg) {
    let title = 'Notification';
    let icon = 'ℹ️';
    const lower = String(msg).toLowerCase();
    if (lower.includes('error') || lower.includes('failed') || lower.includes('incorrect') || lower.includes('invalid') || lower.includes('unauthorized')) {
        title = 'Error';
        icon = '❌';
    } else if (lower.includes('success') || lower.includes('updated') || lower.includes('saved') || lower.includes('sent')) {
        title = 'Success';
        icon = '✅';
    }
    window.showCustomAlert(title, msg, icon);
};

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
            await showCustomAlert('Sign In Failed', 'Invalid credentials. Please refer to login hint below the card.', '🔒');
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
            // Eagerly load bank details so the form is scoped to this user immediately
            loadBankDetails();
            loadSalaryHistory();
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
        loadChatHistory();
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

    // Clear bank details form to prevent data leakage to the next user
    const bankNameEl = document.getElementById('bank-account-name');
    const bankNumberEl = document.getElementById('bank-account-number');
    const bankIfscEl = document.getElementById('bank-ifsc');
    if (bankNameEl) bankNameEl.value = '';
    if (bankNumberEl) bankNumberEl.value = '';
    if (bankIfscEl) bankIfscEl.value = '';
    toggleBankInputs(false);

    // Clear chatbot history
    const fsChatBody = document.getElementById('fullscreen-chat-body');
    if (fsChatBody) {
        fsChatBody.innerHTML = '';
    }
    const fsChatInput = document.getElementById('fullscreen-chat-input');
    if (fsChatInput) {
        fsChatInput.value = '';
    }
});

// Periodic Synchronization
async function syncStateData() {
    if (isUploading) return;
    if (window.isConfirming) return;
    if (!currentUser) return;
    const editDrawer = document.getElementById('hr-edit-drawer');
    if (editDrawer && !editDrawer.classList.contains('hidden')) return;
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

        if (targetTab === 'candidate-documents') {
            localStorage.setItem(`has_clicked_docs_alert_${currentUser}`, 'true');
            btn.classList.remove('blinking-alert');
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

    if (tabId === 'candidate-settings') {
        showSettingsView('main');
    }
    if (tabId === 'candidate-chatbot') {
        setTimeout(() => {
            fullscreenChatBody.scrollTop = fullscreenChatBody.scrollHeight;
        }, 50);
    }
    if (tabId === 'candidate-calendar') {
        initCalendar();
    }
    if (tabId === 'admin-calendar') {
        initAdminCalendar();
    }
}

function showSettingsView(viewName) {
    const mainList = document.getElementById('settings-main-list');
    const passwordView = document.getElementById('settings-change-password-view');
    const emailView = document.getElementById('settings-update-email-view');
    const photoView = document.getElementById('settings-upload-profile-photo-view');

    if (!mainList || !passwordView || !emailView) return;

    mainList.classList.add('hidden');
    passwordView.classList.add('hidden');
    emailView.classList.add('hidden');
    if (photoView) photoView.classList.add('hidden');

    if (viewName === 'change-password') {
        passwordView.classList.remove('hidden');
    } else if (viewName === 'update-email') {
        emailView.classList.remove('hidden');
    } else if (viewName === 'upload-profile-photo') {
        if (photoView) {
            photoView.classList.remove('hidden');
            const teacher = systemState.teachers[currentUser];
            const previewContainer = document.getElementById('settings-photo-preview-container');
            const photoStatus = document.getElementById('settings-photo-status');
            if (teacher && previewContainer && photoStatus) {
                if (teacher.profile_photo_url) {
                    previewContainer.innerHTML = `<img src="${teacher.profile_photo_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    photoStatus.innerText = "Custom profile photo active";
                } else {
                    previewContainer.innerHTML = '<svg viewBox="0 0 100 100" style="width: 100%; height: 100%; display: block;"><circle cx="50" cy="38" r="18" fill="#959da5"/><path d="M50 62c-16 0-29 11-29 25h58c0-14-13-25-29-25z" fill="#959da5"/></svg>';
                    photoStatus.innerText = "No custom photo uploaded";
                }
            }
        }
    } else {
        mainList.classList.remove('hidden');
    }
}


// Update DOM elements using loaded state
function updateDashboardView() {
    if (!systemState) return;

    // Sidebar Blinking Alert for Candidate's Chatbot Tab
    const teacher = (systemState.teachers && systemState.teachers[currentUser]) ? systemState.teachers[currentUser] : null;
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    if (sidebarAvatar) {
        if (teacher && teacher.profile_photo_url) {
            sidebarAvatar.innerHTML = `<img src="${teacher.profile_photo_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
            sidebarAvatar.innerHTML = '👤';
        }
    }

    const chatbotTab = document.querySelector('.nav-tab[data-tab="candidate-chatbot"]');
    if (teacher && currentRole === 'candidate') {
        const sidebarEmail = document.getElementById('sidebar-email');
        const sidebarName = document.getElementById('sidebar-name');
        if (sidebarEmail) sidebarEmail.innerText = teacher.email;
        if (sidebarName) sidebarName.innerText = teacher.name;

        const currentStage = teacher.current_stage || 'document_collection';
        if (currentStage === 'document_collection') {
            localStorage.removeItem(`has_clicked_policy_alert_${currentUser}`);
        }
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
        const profLeaves = document.getElementById('prof-leaves');
        if (profLeaves) {
            profLeaves.innerText = teacher.leave_balance;
        }
        const profEmpid = document.getElementById('prof-empid');
        if (profEmpid) {
            profEmpid.innerText = teacher.employee_id || 'Not Assigned';
        }

        // Onboarding Status / PESU Companion Brief
        const statusVal = document.getElementById('onboarding-status-val');
        const statusContainer = document.getElementById('onboarding-status-container');
        const statusSubtitle = document.getElementById('onboarding-status-subtitle');
        if (statusVal && statusContainer) {
            if (teacher.onboarding_completed) {
                if (statusSubtitle) {
                    statusSubtitle.innerText = "PESU Companion | Your Daily Brief";
                }
                const brief = teacher.pesu_companion_brief || '💰 Salary for the month has been credited.\n📅 No upcoming meetings or events scheduled.';
                statusVal.innerHTML = formatMarkdown(brief);
                statusContainer.style.border = '1px solid rgba(88, 166, 255, 0.3)';
                statusContainer.style.background = 'rgba(88, 166, 255, 0.02)';
            } else {
                if (statusSubtitle) {
                    statusSubtitle.innerText = "PESU Companion | Welcome & Setup";
                }
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
        }

        // Add blink effect to Submit Documents tab if upload is pending
        const docTab = document.querySelector('.nav-tab[data-tab="candidate-documents"]');
        if (docTab) {
            const hasClickedDocs = localStorage.getItem(`has_clicked_docs_alert_${currentUser}`) === 'true';
            const msg = teacher.onboarding_status_message || '';
            if (!hasClickedDocs && msg.toLowerCase().includes('upload documents')) {
                docTab.classList.add('blinking-alert');
            } else {
                docTab.classList.remove('blinking-alert');
            }
        }

        // Seating Info
        const seatVal = document.getElementById('seating-allocated-val');
        seatVal.innerText = teacher.seating_info || 'Not Allotted';

        // Calendar Schedule
        teacherSchedule = teacher.schedule || [];

        // Attendance Record
        const presentCount = document.getElementById('attendance-present-count');
        const absentCount = document.getElementById('attendance-absent-count');
        const totalWorkingDays = document.getElementById('attendance-total-working-days');
        
        function getWeekdaysInMonthUpToToday() {
            const date = new Date();
            const year = date.getFullYear();
            const month = date.getMonth();
            const todayDay = date.getDate();
            let weekdays = 0;
            for (let d = 1; d <= todayDay; d++) {
                const curDate = new Date(year, month, d);
                const dayOfWeek = curDate.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                    weekdays++;
                }
            }
            return weekdays;
        }

        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const currentMonth = currentDate.getMonth();
        
        let lopDays = 0;
        let regularLeaves = 0;
        const absentRecordList = [];

        if (teacher.attendance) {
            teacher.attendance.forEach(att => {
                if (att.status === 'Absent') {
                    const attDate = new Date(att.date);
                    const isCurrentMonthObj = (attDate.getFullYear() === currentYear && attDate.getMonth() === currentMonth);

                    // Find corresponding leave request
                    const leaveReq = (teacher.applied_leaves || []).find(lvl => lvl.date === att.date);

                    if (leaveReq && (leaveReq.status === 'approved' || leaveReq.status === 'accepted')) {
                        // Paid leave: count towards regular leaves, do not add to absent table
                        if (isCurrentMonthObj) {
                            regularLeaves++;
                        }
                    } else {
                        // Unpaid / LOP / Pending / Rejected: count towards LOP, show in absent table
                        if (isCurrentMonthObj) {
                            lopDays++;
                        }

                        absentRecordList.push({
                            date: att.date,
                            type: leaveReq ? leaveReq.type : 'Absent (No leave requested)',
                            title: leaveReq ? (leaveReq.title || leaveReq.type) : 'Loss of Pay',
                            description: leaveReq ? (leaveReq.description || '') : 'Absent without approved leave request.',
                            document_url: leaveReq ? (leaveReq.document_url || '') : '',
                            status: leaveReq ? leaveReq.status : 'Loss of Pay'
                        });
                    }
                }
            });
        }

        const tDays = systemState.global_working_days !== undefined ? systemState.global_working_days : 26;
        const aDays = regularLeaves + lopDays;
        const pDays = teacher.present_days !== undefined ? teacher.present_days : 24;
        
        if (presentCount) presentCount.innerText = pDays;
        if (absentCount) absentCount.innerText = aDays;
        if (totalWorkingDays) totalWorkingDays.innerText = tDays;
        
        const lossOfPayLeaves = document.getElementById('attendance-loss-of-pay-leaves');
        if (lossOfPayLeaves) lossOfPayLeaves.innerText = lopDays;

        const attendanceBody = document.getElementById('attendance-record-body');
        attendanceBody.innerHTML = '';
        
        absentRecordList.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (absentRecordList.length > 0) {
            absentRecordList.forEach(item => {
                let statusBadge = '';
                if (item.status === 'pending') {
                    statusBadge = '<span class="badge" style="background: #e3b341; color: #0d1117; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">Pending</span>';
                } else if (item.status === 'approved' || item.status === 'accepted') {
                    statusBadge = '<span class="badge" style="background: #2ea043; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">Accepted</span>';
                } else if (item.status === 'rejected') {
                    statusBadge = '<span class="badge" style="background: #f85149; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">Rejected</span>';
                } else {
                    statusBadge = '<span class="badge" style="background: #f85149; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 0.8rem;">Loss of Pay</span>';
                }
                
                let docHTML = '';
                if (item.document_url) {
                    docHTML = `<br><a href="#" onclick="window.viewDoc('${item.document_url}'); return false;" style="font-size: 0.8rem; color: #58a6ff; text-decoration: underline;">📄 View Support Doc</a>`;
                }
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${item.date}</strong></td>
                    <td>
                        <div style="font-weight: 600; color: #c9d1d9;">${item.title}</div>
                        <div style="font-size: 0.85rem; color: #8b949e;">${item.description || item.type}</div>
                        ${docHTML}
                    </td>
                    <td>${statusBadge}</td>
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
                        } catch (e) {
                            return pathString;
                        }
                    };
                    statusElem.innerText = getFileName(path);
                    dropArea.style.pointerEvents = 'none';
                    if (fileInput) fileInput.disabled = true;
                    if (button) {
                        button.disabled = true;
                        button.innerHTML = `<span>${status === 'approved' ? 'Approved ✓' : 'Pending Review'}</span>`;
                        button.style.pointerEvents = 'none';
                    }
                } else {
                    card.classList.remove('staged');
                    dropArea.style.pointerEvents = 'auto';
                    if (fileInput) fileInput.disabled = false;
                    if (button) {
                        button.disabled = false;
                        button.innerHTML = `<span>Choose PDF</span><span class="upload-btn-arrow">📤</span>`;
                        button.style.pointerEvents = 'auto';
                    }

                    if (status === 'rejected' && !(fileInput && fileInput.files && fileInput.files.length > 0)) {
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

        // Render projects list
        const projectsListContainer = document.getElementById('projects-list-container');
        if (projectsListContainer) {
            projectsListContainer.innerHTML = '';
            if (teacher.projects && teacher.projects.length > 0) {
                const grid = document.createElement('div');
                grid.style.display = 'flex';
                grid.style.flexDirection = 'column';
                grid.style.gap = '12px';
                grid.className = 'mt-3';

                // Sort projects based on current selection
                const sortOption = document.getElementById('project-sort-option')?.value || 'date_desc';
                const sortedProjects = [...teacher.projects];

                sortedProjects.sort((a, b) => {
                    let valA, valB;
                    if (sortOption === 'name_asc') {
                        valA = (a.title || '').toLowerCase();
                        valB = (b.title || '').toLowerCase();
                        if (valA < valB) return -1;
                        if (valA > valB) return 1;
                    } else { // 'date_desc'
                        valA = a.uploaded_at ? new Date(a.uploaded_at) : new Date(0);
                        valB = b.uploaded_at ? new Date(b.uploaded_at) : new Date(0);
                        if (valA < valB) return 1;
                        if (valA > valB) return -1;
                    }
                    return 0;
                });

                sortedProjects.forEach((proj, idx) => {
                    const item = document.createElement('div');
                    item.style.background = 'rgba(255, 255, 255, 0.02)';
                    item.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                    item.style.borderRadius = '8px';
                    item.style.padding = '15px';
                    item.style.display = 'flex';
                    item.style.justifyContent = 'space-between';
                    item.style.alignItems = 'center';

                    item.innerHTML = `
                        <div style="display: flex; flex-direction: column; gap: 4px; text-align: left;">
                            <span style="font-weight: 600; color: #c9d1d9; font-size: 1rem;">${proj.title}</span>
                            <span style="font-size: 0.8rem; color: #8b949e;">File: ${proj.filename} | Uploaded: ${proj.uploaded_at || 'N/A'}</span>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary btn-sm" onclick="window.viewDoc('${proj.file_url}')" style="padding: 6px 16px; font-size: 0.85rem;">
                                👁️ View
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="window.deleteProject('${proj.filename}')" style="padding: 6px 16px; font-size: 0.85rem;">
                                🗑️ Delete
                            </button>
                        </div>
                    `;
                    grid.appendChild(item);
                });
                projectsListContainer.appendChild(grid);
            } else {
                projectsListContainer.innerHTML = `
                    <div class="empty-projects-box mt-3">
                        <p class="text-muted">No projects or publications found in record.</p>
                    </div>
                `;
            }
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

            const matchesQuery = !hrQuery ||
                (t.name && t.name.toLowerCase().includes(hrQuery)) ||
                (t.username && t.username.toLowerCase().includes(hrQuery)) ||
                (t.email && t.email.toLowerCase().includes(hrQuery)) ||
                (t.employee_id && t.employee_id.toLowerCase().includes(hrQuery));

            if (teachersListContainer && matchesQuery) {
                const div = document.createElement('div');
                div.className = 'teacher-card-item';
                div.setAttribute('data-username', t.username);

                let avatarHTML = '<span style="font-size: 1.5rem; margin-right: 12px; background: rgba(255,255,255,0.05); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">👤</span>';
                if (t.profile_photo_url) {
                    avatarHTML = `<img src="${t.profile_photo_url}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; margin-right: 12px; border: 1px solid rgba(255,255,255,0.1);">`;
                }

                div.innerHTML = `
                    <div style="display: flex; align-items: center;">
                        ${avatarHTML}
                        <div class="teacher-card-info">
                            <h4>${t.name} (@${t.username})</h4>
                            <p>${t.designation} - ${t.department}</p>
                            <p style="font-size:0.8rem; color:var(--text-secondary); margin-bottom: 2px;">Email: ${t.email || 'N/A'} | Emp ID: ${t.employee_id || 'None'}</p>
                            <p style="font-size:0.75rem; color:var(--text-muted)">Seating: ${t.seating_info}</p>
                        </div>
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
                    // Update photo container in drawer
                    const activeTeacher = systemState.teachers[activeUsername];
                    const photoContainer = document.getElementById('edit-photo-container');
                    if (photoContainer && activeTeacher) {
                        if (activeTeacher.profile_photo_url) {
                            photoContainer.innerHTML = `
                                <div style="display: flex; align-items: center; gap: 15px; background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 8px;">
                                    <img src="${activeTeacher.profile_photo_url}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);">
                                    <div style="display: flex; flex-direction: column; gap: 4px;">
                                        <span style="font-size: 0.85rem; color: var(--text-secondary);">Profile Photo</span>
                                        <button type="button" class="btn btn-danger btn-sm" onclick="window.removeProfilePhoto('${activeTeacher.username}')" style="padding: 4px 10px; font-size: 0.75rem; width: fit-content; margin-top: 2px;">Remove Photo</button>
                                    </div>
                                </div>
                            `;
                        } else {
                            photoContainer.innerHTML = '';
                        }
                    }
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
                        } catch (e) {
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

        // Populate the teacher select list for marking attendance
        const globalLogDateInput = document.getElementById('hr-global-log-date');
        if (globalLogDateInput && !globalLogDateInput.value) {
            const today = new Date();
            const offset = today.getTimezoneOffset();
            const localToday = new Date(today.getTime() - (offset*60*1000));
            globalLogDateInput.value = localToday.toISOString().split('T')[0];
        }
        if (globalLogDateInput && !globalLogDateInput.dataset.listenerBound) {
            globalLogDateInput.addEventListener('change', () => {
                updateDashboardView();
            });
            globalLogDateInput.dataset.listenerBound = "true";
        }

        const hrAttendanceTeachersList = document.getElementById('hr-attendance-teachers-list');
        if (hrAttendanceTeachersList) {
            hrAttendanceTeachersList.innerHTML = '';
            Object.keys(systemState.teachers).forEach(uname => {
                const t = systemState.teachers[uname];
                const selectedDate = globalLogDateInput ? globalLogDateInput.value : '';
                const isAbsent = (t.attendance || []).some(att => att.date === selectedDate);
                
                const row = document.createElement('div');
                row.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.06); padding: 12px 18px; border-radius: 8px; flex-wrap: wrap; gap: 15px; width: 100%; box-sizing: border-box;";
                row.innerHTML = `
                    <div style="text-align: left;">
                        <div style="font-weight: 600; color: #fff; display: flex; align-items: center; gap: 8px;">
                            ${t.name}
                            ${isAbsent ? '<span style="background: rgba(248,81,73,0.15); color: #ff7b72; font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(248,81,73,0.2);">Absent</span>' : '<span style="background: rgba(46,160,67,0.15); color: #56d364; font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; border: 1px solid rgba(46,160,67,0.2);">Present</span>'}
                        </div>
                        <div style="font-size: 0.8rem; color: #8b949e;">${t.department} (@${t.username})</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <input type="text" id="hr-reason-${t.username}" placeholder="Absent Reason (optional)"
                               style="background: #0d1117; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px; color: #c9d1d9; font-size: 0.85rem; outline: none; width: 180px;">
                        <button class="btn btn-success btn-sm" onclick="window.markTeacherAttendance('${t.username}', 'Present')" style="padding: 8px 16px;">Mark Present</button>
                        <button class="btn btn-danger btn-sm" onclick="window.markTeacherAttendance('${t.username}', 'Absent')" style="padding: 8px 16px;">Mark Absent</button>
                    </div>
                `;
                hrAttendanceTeachersList.appendChild(row);
            });
        }

        // Populate Leave Applications tab for HR
        const hrLeavesTab = document.getElementById('hr-leaves-tab');
        const hrLeaveApplicationsList = document.getElementById('hr-leave-applications-list');
        
        let pendingLeavesCount = 0;
        let pendingLeavesHTML = '';

        Object.keys(systemState.teachers).forEach(uname => {
            const t = systemState.teachers[uname];
            const appliedLeaves = t.applied_leaves || [];
            
            appliedLeaves.forEach(lvl => {
                if (lvl.status === 'pending') {
                    pendingLeavesCount++;
                    let docHTML = '';
                    if (lvl.document_url) {
                        docHTML = `
                            <div style="margin-top: 6px;">
                                <button class="btn btn-secondary btn-sm" onclick="viewDoc('${lvl.document_url}')" style="font-size: 0.75rem; padding: 4px 10px;">👁️ View Support Document</button>
                            </div>
                        `;
                    }
                    pendingLeavesHTML += `
                        <div class="verification-teacher-section mt-3" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                            <div style="display: flex; flex-direction: column; gap: 6px; text-align: left; max-width: 70%;">
                                <strong style="color: #fff; font-size: 1.1rem;">${t.name} (@${t.username})</strong>
                                <span style="font-size: 0.95rem; color: #fff; font-weight: 500;">Title: ${lvl.title || lvl.type}</span>
                                <span style="font-size: 0.9rem; color: #c9d1d9;">Type: <strong style="color: #58a6ff;">${lvl.type}</strong></span>
                                <span style="font-size: 0.85rem; color: #8b949e;">Date: ${lvl.date}</span>
                                <p style="font-size: 0.85rem; color: #8b949e; margin: 4px 0 0 0; line-height: 1.4;">${lvl.description || ''}</p>
                                ${docHTML}
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button class="btn btn-success btn-sm" onclick="window.decideLeave('${t.username}', '${lvl.id}', 'approve')" style="padding: 8px 16px;">Accept</button>
                                <button class="btn btn-danger btn-sm" onclick="window.decideLeave('${t.username}', '${lvl.id}', 'reject')" style="padding: 8px 16px;">Reject</button>
                            </div>
                        </div>
                    `;
                }
            });
        });

        if (hrLeavesTab) {
            hrLeavesTab.innerHTML = `Attendance Manager [${pendingLeavesCount}]`;
        }

        if (hrLeaveApplicationsList) {
            if (pendingLeavesCount > 0) {
                hrLeaveApplicationsList.innerHTML = pendingLeavesHTML;
            } else {
                hrLeaveApplicationsList.innerHTML = '<p class="text-muted text-center mt-3">No pending leave applications.</p>';
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
                    const timeA = a.created_at || 0;
                    const timeB = b.created_at || 0;
                    if (timeA !== timeB) {
                        return timeB - timeA;
                    }
                    const nameA = (a.name || '').toLowerCase();
                    const nameB = (b.name || '').toLowerCase();
                    if (nameA < nameB) return -1;
                    if (nameA > nameB) return 1;
                    return 0;
                });
                sortedSeatingTeachers.forEach(t => {
                    const isAllotted = t.seating_info && t.seating_info !== 'Not Allotted';
                    const card = document.createElement('div');
                    card.className = 'verification-teacher-section mt-3';

                    let photoHTML = '';
                    if (t.profile_photo_url) {
                        photoHTML = `
                            <div style="display: flex; align-items: center; gap: 15px; background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 8px;">
                                <img src="${t.profile_photo_url}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);">
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    <span style="font-size: 0.85rem; color: var(--text-secondary);">Profile Photo Uploaded</span>
                                </div>
                            </div>
                        `;
                    }

                    let completeOnboardingHTML = '';
                    if (t.onboarding_completed) {
                        completeOnboardingHTML = `
                            <button class="btn btn-sm" style="padding: 8px 16px; margin-bottom: 8px; width: 100%; font-weight: 600; border-radius: 6px; background: rgba(35, 134, 54, 0.2); border: 1px solid rgba(35, 134, 54, 0.4); color: #56d364; cursor: default;" disabled>
                                Onboarding Process Completed
                            </button>
                        `;
                    } else {
                        completeOnboardingHTML = `
                            <button class="btn btn-sm" style="padding: 8px 16px; margin-bottom: 8px; width: 100%; font-weight: 600; border-radius: 6px; background: rgba(240, 140, 20, 0.2); border: 1px solid rgba(240, 140, 20, 0.4); color: #ffa657; cursor: pointer;" onclick="window.completeOnboarding('${t.username}')">
                                Click to Complete Onboarding Process
                            </button>
                        `;
                    }

                    if (isAllotted) {
                        card.innerHTML = `
                            <div class="verification-teacher-header">${t.name} (@${t.username})</div>
                            <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; gap: 10px;">
                                ${photoHTML}
                                <div><strong>Department:</strong> ${t.department}</div>
                                <div><strong>Designation:</strong> ${t.designation}</div>
                                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
                                    ${completeOnboardingHTML}
                                    <div style="display: flex; gap: 15px; align-items: center; background: rgba(88,166,255,0.05); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(88,166,255,0.15);">
                                        <span style="font-size: 0.85rem; flex: 1;">📍 Seating: <strong style="color: #58a6ff;">${t.seating_info}</strong></span>
                                        <button class="btn btn-secondary btn-sm" style="padding: 4px 12px;" onclick="enableSeatingEdit('${t.username}')">Edit</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        card.innerHTML = `
                            <div class="verification-teacher-header">${t.name} (@${t.username})</div>
                            <div style="padding: 15px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05); display: flex; flex-direction: column; gap: 10px;">
                                ${photoHTML}
                                <div><strong>Department:</strong> ${t.department}</div>
                                <div><strong>Designation:</strong> ${t.designation}</div>
                                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
                                    ${completeOnboardingHTML}
                                    <div style="display: flex; gap: 10px; align-items: center; justify-content: space-between;">
                                        <span style="font-size: 0.85rem; color: var(--text-secondary);">📍 Seating: <strong style="color: var(--text-secondary);">Not Allotted</strong></span>
                                        <button class="btn btn-primary btn-sm" style="padding: 8px 16px;" onclick="openSeatingModal('${t.username}')">Allocate Space</button>
                                    </div>
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

                const matchesQuery = !adminQuery ||
                    (t.name && t.name.toLowerCase().includes(adminQuery)) ||
                    (t.email && t.email.toLowerCase().includes(adminQuery)) ||
                    (t.employee_id && t.employee_id.toLowerCase().includes(adminQuery));

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
                        <td style="font-family: monospace; font-size: 0.9rem; color: #58a6ff;">${t.employee_id || 'N/A'}</td>
                    `;
                    adminTeachersTableBody.appendChild(tr);
                }
            });
        }
    }
}



// HR Log Attendance Global Helper
window.markTeacherAttendance = async function(username, status) {
    const dateInput = document.getElementById('hr-global-log-date');
    if (!dateInput || !dateInput.value) {
        alert('Please select a date first.');
        return;
    }
    const dateVal = dateInput.value;
    const reasonInput = document.getElementById(`hr-reason-${username}`);
    const reasonVal = reasonInput ? reasonInput.value.trim() : '';
    
    // Optimistic update
    const teacher = systemState.teachers[username];
    if (teacher) {
        if (!teacher.attendance) teacher.attendance = [];
        teacher.attendance = teacher.attendance.filter(att => att.date !== dateVal);
        if (status === 'Absent') {
            teacher.attendance.push({
                date: dateVal,
                status: 'Absent',
                reason: reasonVal || 'Marked Absent by HR'
            });
        } else {
            teacher.attendance.push({
                date: dateVal,
                status: 'Present',
                reason: 'Marked Present by HR'
            });
        }
        updateDashboardView();
    }
    
    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'log_attendance',
                payload: {
                    username: username,
                    date: dateVal,
                    status: status,
                    reason: reasonVal
                }
            })
        });
        
        if (res.ok) {
            syncStateData();
            if (reasonInput) reasonInput.value = '';
        } else {
            const err = await res.json();
            alert(`Failed to log attendance: ${err.detail || 'Unknown error'}`);
        }
    } catch (error) {
        alert('Server communication error.');
    }
};

// HR Add Teacher Form
const hrAddTeacherForm = document.getElementById('hr-add-teacher-form');
hrAddTeacherForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        name: document.getElementById('add-name').value,
        email: document.getElementById('add-email').value,
        department: document.getElementById('add-dept').value,
        designation: document.getElementById('add-desig').value,
        employee_id: document.getElementById('add-empid').value.trim(),
        created_at: Date.now()
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
        created_at: payload.created_at,
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

window.viewDoc = function (docName) {
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

window.deleteProject = async function(filename) {
    const confirmed = await showCustomConfirm(
        "Delete Project",
        "Are you sure you want to permanently delete this project/publication?",
        "🗑️"
    );
    if (!confirmed) {
        return;
    }

    const teacher = systemState.teachers[currentUser];
    if (!teacher) return;

    // Save original state for rollback
    const originalProjects = [...(teacher.projects || [])];

    // Optimistic Update
    teacher.projects = (teacher.projects || []).filter(p => p.filename !== filename);
    updateDashboardView();

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'delete_project',
                payload: { username: currentUser, filename: filename }
            })
        });

        if (!res.ok) {
            // Rollback
            teacher.projects = originalProjects;
            updateDashboardView();
            const err = await res.json();
            alert(`Error deleting project: ${err.detail}`);
        } else {
            syncStateData();
        }
    } catch (e) {
        // Rollback
        teacher.projects = originalProjects;
        updateDashboardView();
        alert('Server communication error.');
    }
};

window.completeOnboarding = async function(username) {
    const confirmed = await showCustomConfirm(
        'Complete Onboarding',
        `Are you sure you want to mark onboarding as completed for @${username}?`,
        '✅'
    );
    if (!confirmed) return;
    
    // Save original for rollback
    const originalOnboarding = systemState.teachers[username].onboarding_completed;
    
    // Optimistic Update
    systemState.teachers[username].onboarding_completed = true;
    updateDashboardView();
    
    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'complete_onboarding',
                payload: { username }
            })
        });
        
        if (!res.ok) {
            systemState.teachers[username].onboarding_completed = originalOnboarding;
            updateDashboardView();
            const err = await res.json();
            await showCustomAlert('Action Failed', `Error: ${err.detail}`);
        } else {
            syncStateData();
        }
    } catch (e) {
        systemState.teachers[username].onboarding_completed = originalOnboarding;
        updateDashboardView();
        await showCustomAlert('Network Error', 'Server communication error.');
    }
};

window.removeProfilePhoto = async function(username) {
    const confirmed = await showCustomConfirm(
        "Remove Profile Photo",
        "Are you sure you want to permanently remove this teacher's profile photo?",
        "👤"
    );
    if (!confirmed) {
        return;
    }

    const teacher = systemState.teachers[username];
    if (!teacher) return;

    // Save original state for rollback
    const originalPhotoUrl = teacher.profile_photo_url;

    // Optimistic Update
    teacher.profile_photo_url = "";
    updateDashboardView();

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'remove_profile_photo',
                payload: { username }
            })
        });

        if (!res.ok) {
            // Rollback
            teacher.profile_photo_url = originalPhotoUrl;
            updateDashboardView();
            const err = await res.json();
            alert(`Error removing profile photo: ${err.detail}`);
        } else {
            syncStateData();
        }
    } catch (e) {
        // Rollback
        teacher.profile_photo_url = originalPhotoUrl;
        updateDashboardView();
        alert('Server communication error.');
    }
};

window.verifyDoc = async function (username, docName, docType, approved) {
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
    } catch (err) {
        // Rollback
        teacher.document_statuses = originalStatus;
        teacher.current_stage = originalStage;
        teacher.onboarding_status_message = originalMessage;
        updateDashboardView();
        alert('Server communication error.');
    }
};

window.editAnnouncement = function (id, currentTitle, currentContent) {
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
    } catch (err) {
        // Rollback
        systemState.announcements = originalAnnouncements;
        updateDashboardView();
        alert('Server communication error.');
    }
});

window.deleteAnnouncement = async function(id) {
    const confirmed = await showCustomConfirm(
        "Delete Announcement",
        "Are you sure you want to delete this announcement?",
        "📢"
    );
    if (!confirmed) return;
    
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
    } catch (err) {
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

    // Handle photo display/delete
    const photoContainer = document.getElementById('edit-photo-container');
    if (photoContainer) {
        if (t.profile_photo_url) {
            photoContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 15px; background: rgba(255,255,255,0.02); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-bottom: 8px;">
                    <img src="${t.profile_photo_url}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-size: 0.85rem; color: var(--text-secondary);">Profile Photo</span>
                        <button type="button" class="btn btn-danger btn-sm" onclick="window.removeProfilePhoto('${t.username}')" style="padding: 4px 10px; font-size: 0.75rem; width: fit-content; margin-top: 2px;">Remove Photo</button>
                    </div>
                </div>
            `;
        } else {
            photoContainer.innerHTML = '';
        }
    }

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
    systemState.teachers[username] = {
        ...systemState.teachers[username],
        name: payload.name,
        email: payload.email,
        department: payload.department,
        designation: payload.designation,
        employee_id: payload.employee_id
    };
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

    const confirmed = await showCustomConfirm(
        "Delete Profile",
        `Are you sure you want to permanently delete the profile for @${username}?`,
        "🗑️"
    );
    if (confirmed) {
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

        isUploading = true;

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
                    if (!res.ok) {
                        throw new Error(`Upload failed for ${item.type}`);
                    }
                }
                isUploading = false;
                syncStateData();
            } catch (err) {
                console.error(err);
                // Rollback
                systemState.teachers[currentUser] = originalTeacher;
                isUploading = false;
                updateDashboardView();
                alert('Server communication error during document upload.');
                updateSubmitButtonState();
            }
        })();
    });
}

// Dynamic Seating Allotment Trigger
window.allocateSeating = async function (username) {
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

window.enableSeatingEdit = function (username) {
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

// Change Password Form Submission
const changePasswordForm = document.getElementById('change-password-form');
if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('settings-current-password').value;
        const newPassword = document.getElementById('settings-new-password').value;
        const confirmPassword = document.getElementById('settings-confirm-password').value;

        if (newPassword !== confirmPassword) {
            alert("New passwords do not match.");
            return;
        }

        const payload = {
            username: currentUser,
            current_password: currentPassword,
            new_password: newPassword
        };

        try {
            const res = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'change_password', payload })
            });

            if (res.ok) {
                alert('Password updated successfully!');
                changePasswordForm.reset();
                syncStateData();
            } else {
                const err = await res.json();
                alert(`Error updating password: ${err.detail || 'Incorrect current password.'}`);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to connect to the server.');
        }
    });
}

// Update Email Form Submission
const updateEmailForm = document.getElementById('update-email-form');
if (updateEmailForm) {
    updateEmailForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const prefix = document.getElementById('settings-email-prefix').value.trim();
        if (!prefix) return;

        const cleanedPrefix = prefix.replace(/@pes\.edu$/i, '').trim();
        const newEmail = `${cleanedPrefix}@pes.edu`;

        const payload = {
            username: currentUser,
            new_email: newEmail
        };

        try {
            const res = await fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update_email', payload })
            });

            if (res.ok) {
                alert('Email address updated successfully!');
                updateEmailForm.reset();
                syncStateData();
            } else {
                const err = await res.json();
                alert(`Error updating email: ${err.detail || 'Request failed.'}`);
            }
        } catch (e) {
            console.error(e);
            alert('Failed to connect to the server.');
        }
    });
}

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

    // Show thinking indicator bubble with custom blinking "Thinking..." text
    const thinkingBubble = appendFullscreenChatBubble('bot', '<span class="blinking-thinking">Thinking...</span>', true);
    thinkingBubble.id = 'thinking-bubble';

    // Scroll to the bottom so the thinking bubble is fully in view
    setTimeout(() => {
        fullscreenChatBody.scrollTo({
            top: fullscreenChatBody.scrollHeight,
            behavior: 'smooth'
        });
    }, 50);

    // Extract history of previous 3 exchanges (up to last 6 messages) from the DOM
    const bubbles = Array.from(fullscreenChatBody.querySelectorAll('.chat-message'));
    const historyList = [];
    for (let i = 0; i < bubbles.length - 1; i++) {
        const b = bubbles[i];
        if (b.id === 'thinking-bubble') continue;
        const role = b.classList.contains('user') ? 'user' : 'assistant';
        historyList.push({ role: role, content: b.innerText });
    }
    const lastSixHistory = historyList.slice(-6);

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, username: currentUser, history: lastSixHistory })
        });

        // Remove thinking bubble
        const tb = document.getElementById('thinking-bubble');
        if (tb) tb.remove();

        if (!res.ok) {
            throw new Error('Network response was not ok');
        }

        const botBubble = appendFullscreenChatBubble('bot', '<span class="blinking-thinking">Thinking...</span>', true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulatedResponse = "";
        let isFirstChunk = true;

        // Typewriter rendering queue configuration
        let wordQueue = [];
        let renderText = "";
        let isRendering = false;

        function startTypewriter() {
            if (isRendering) return;
            isRendering = true;

            function nextWord() {
                if (wordQueue.length > 0) {
                    const next = wordQueue.shift();
                    renderText += next;
                    botBubble.innerHTML = formatMarkdown(renderText);
                    fullscreenChatBody.scrollTo({
                        top: fullscreenChatBody.scrollHeight,
                        behavior: 'smooth'
                    });

                    // Dynamically adjust delay: speed up to print faster if queue backlog increases
                    const currentDelay = Math.max(5, 20 - wordQueue.length * 2);
                    setTimeout(nextWord, currentDelay);
                } else {
                    isRendering = false;
                }
            }
            nextWord();
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            if (isFirstChunk && chunk.length > 0) {
                botBubble.innerHTML = "";
                isFirstChunk = false;
            }
            accumulatedResponse += chunk;

            // Split chunk into words/spaces and push to typewriter queue
            const parts = chunk.match(/\s*\S+\s*/g) || [chunk];
            wordQueue.push(...parts);
            startTypewriter();
        }

        // Wait until typewriter queue has fully finished rendering before saving history
        while (isRendering || wordQueue.length > 0) {
            await new Promise(r => setTimeout(r, 100));
        }
        saveChatHistory();
    } catch (e) {
        const tb = document.getElementById('thinking-bubble');
        if (tb) tb.remove();
        appendFullscreenChatBubble('bot', 'Error communicating with Pinecone RAG search agent.');
    }
    fullscreenChatBody.scrollTo({
        top: fullscreenChatBody.scrollHeight,
        behavior: 'smooth'
    });
}

function formatMarkdown(text) {
    if (!text) return '';
    // Clean up citations: e.g. [cite: 1], [cite:1], [cite], etc.
    let cleaned = text.replace(/\[cite:?\s*\d*\]/gi, '');

    // Split by newlines to parse line-by-line (e.g. lists)
    let lines = cleaned.split('\n');
    let inList = false;
    let htmlOutput = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let trimmed = line.trim();

        // Check if the line is a bullet point (starts with *, -, or •)
        let isBullet = /^[*•-]\s+/.test(trimmed);

        if (isBullet) {
            if (!inList) {
                htmlOutput.push('<ul style="margin: 0.35rem 0; padding-left: 1.25rem; list-style-type: disc;">');
                inList = true;
            }
            // Remove the bullet character from the beginning
            let content = trimmed.replace(/^[*•-]\s+/, '');

            // Format inline elements inside the bullet content
            content = formatInlineMarkdown(content);
            htmlOutput.push('<li style="margin-bottom: 0.25rem; line-height: 1.4; color: #e6edf3;">' + content + '</li>');
        } else {
            if (inList) {
                htmlOutput.push('</ul>');
                inList = false;
            }

            // Format inline elements
            let content = formatInlineMarkdown(line);
            htmlOutput.push(content);
        }
    }

    if (inList) {
        htmlOutput.push('</ul>');
    }

    // Join with <br> for non-list items
    let finalHtml = '';
    for (let i = 0; i < htmlOutput.length; i++) {
        let block = htmlOutput[i];
        if (block.startsWith('<ul') || block.startsWith('</ul') || block.startsWith('<li')) {
            finalHtml += block;
        } else {
            finalHtml += block + (i < htmlOutput.length - 1 ? '<br>' : '');
        }
    }

    return finalHtml;
}

function formatInlineMarkdown(text) {
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

    // Convert single asterisks bold/italic: *text* -> <em>$1</em>
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');

    return escaped;
}

function saveChatHistory() {
    if (!currentUser) return;
    const messages = [];
    fullscreenChatBody.querySelectorAll('.chat-message').forEach(bubble => {
        if (bubble.id === 'thinking-bubble') return;
        const sender = bubble.classList.contains('user') ? 'user' : 'bot';
        messages.push({ sender, html: bubble.innerHTML });
    });
    localStorage.setItem(`chat_history_${currentUser}`, JSON.stringify(messages));
}

function loadChatHistory() {
    fullscreenChatBody.innerHTML = '';
    if (!currentUser) return;
    const stored = localStorage.getItem(`chat_history_${currentUser}`);
    if (stored) {
        try {
            const messages = JSON.parse(stored);
            messages.forEach(msg => {
                const bubble = document.createElement('div');
                bubble.className = `chat-message ${msg.sender}`;
                bubble.innerHTML = msg.html;
                fullscreenChatBody.appendChild(bubble);
            });
            setTimeout(() => {
                fullscreenChatBody.scrollTop = fullscreenChatBody.scrollHeight;
            }, 100);
        } catch (e) {
            console.error('Failed to parse chat history', e);
        }
    }
}

function appendFullscreenChatBubble(sender, text, isHtml = false) {
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${sender}`;
    bubble.innerHTML = isHtml ? text : formatMarkdown(text);
    fullscreenChatBody.appendChild(bubble);
    saveChatHistory();
    return bubble;
}

async function sendHiddenPolicyQuery() {
    const thinkingBubble = appendFullscreenChatBubble('bot', 'Thinking...');
    thinkingBubble.id = 'thinking-bubble';

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'load_basic_policies_rag', username: currentUser })
        });

        const tb = document.getElementById('thinking-bubble');
        if (tb) tb.remove();

        if (!res.ok) {
            throw new Error('Network response was not ok');
        }

        const welcomeText = await res.text();
        appendFullscreenChatBubble('bot', welcomeText);
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

// Seating Allotment Modal Logic
let activeSeatingUsername = null;
let activeSeatingRoom = '101';

const SEATING_ROOMS = ['101', '102', '201', '202', '301', '302', '401', '402'];

window.openSeatingModal = function (username) {
    activeSeatingUsername = username;
    const t = systemState.teachers[username];
    if (!t) return;

    document.getElementById('seating-modal-teacher-subtitle').innerText = `Select a room and desk for ${t.name} (@${username})`;

    // Parse current seating if any to set activeSeatingRoom
    if (t.seating_info && t.seating_info.startsWith('Room ')) {
        const parts = t.seating_info.split(',');
        if (parts.length > 0) {
            const roomPart = parts[0].replace('Room ', '').trim();
            if (SEATING_ROOMS.includes(roomPart)) {
                activeSeatingRoom = roomPart;
            }
        }
    } else {
        activeSeatingRoom = SEATING_ROOMS[0];
    }

    renderSeatingModalRooms();
    renderSeatingModalSeats();

    document.getElementById('admin-seating-modal').classList.remove('hidden');
};

function renderSeatingModalRooms() {
    const container = document.getElementById('seating-modal-rooms');
    if (!container) return;
    container.innerHTML = '';

    SEATING_ROOMS.forEach(room => {
        const btn = document.createElement('button');
        btn.innerText = `Room ${room}`;
        btn.style.background = (room === activeSeatingRoom) ? 'rgba(88, 166, 255, 0.15)' : 'rgba(255,255,255,0.03)';
        btn.style.border = (room === activeSeatingRoom) ? '1px solid #58a6ff' : '1px solid rgba(255,255,255,0.08)';
        btn.style.color = (room === activeSeatingRoom) ? '#58a6ff' : '#fff';
        btn.style.padding = '12px 15px';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';
        btn.style.textAlign = 'left';
        btn.style.fontWeight = '600';
        btn.style.transition = 'all 0.2s ease';

        btn.addEventListener('click', () => {
            activeSeatingRoom = room;
            renderSeatingModalRooms();
            renderSeatingModalSeats();
        });

        container.appendChild(btn);
    });
}

function renderSeatingModalSeats() {
    const grid = document.getElementById('seating-modal-seats-grid');
    const title = document.getElementById('seating-modal-selected-room-title');
    if (!grid || !title) return;

    title.innerText = `Room ${activeSeatingRoom} Seating Plan`;
    grid.innerHTML = '';

    // Find occupied seats in activeSeatingRoom across all teachers
    const occupiedSeats = {};
    Object.values(systemState.teachers).forEach(t => {
        if (t.seating_info && t.seating_info.startsWith(`Room ${activeSeatingRoom},`)) {
            const parts = t.seating_info.split(', ');
            if (parts.length > 1) {
                const seatInfo = parts[1].replace('Seat ', '').replace('Desk ', '').trim();
                occupiedSeats[seatInfo] = t.name;
            }
        }
    });

    // Generate 16 seats
    for (let seatNum = 1; seatNum <= 16; seatNum++) {
        const seatKey = String(seatNum);
        const occupiedBy = occupiedSeats[seatKey];

        const cell = document.createElement('div');
        cell.innerText = seatKey;
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.style.height = '60px';
        cell.style.borderRadius = '8px';
        cell.style.fontWeight = '600';
        cell.style.fontSize = '1.1rem';
        cell.style.transition = 'all 0.2s ease';

        if (occupiedBy) {
            // Occupied seat styling (grey background, grey text, not clickable)
            cell.style.background = 'rgba(255, 255, 255, 0.05)';
            cell.style.border = '1px solid rgba(255, 255, 255, 0.08)';
            cell.style.color = 'rgba(255, 255, 255, 0.25)';
            cell.style.cursor = 'not-allowed';
            cell.title = `Occupied by ${occupiedBy}`;
        } else {
            // Available seat styling (green border/outline, dark background)
            cell.style.background = 'rgba(46, 160, 67, 0.03)';
            cell.style.border = '2px solid #2ea043';
            cell.style.color = '#2ea043';
            cell.style.cursor = 'pointer';
            cell.title = `Seat ${seatKey} (Available)`;

            cell.addEventListener('mouseover', () => {
                cell.style.background = 'rgba(46, 160, 67, 0.15)';
                cell.style.color = '#fff';
            });
            cell.addEventListener('mouseout', () => {
                cell.style.background = 'rgba(46, 160, 67, 0.03)';
                cell.style.color = '#2ea043';
            });

            cell.addEventListener('click', async () => {
                await selectSeat(activeSeatingRoom, seatKey);
            });
        }
        grid.appendChild(cell);
    }
}

async function selectSeat(room, seatKey) {
    if (!activeSeatingUsername) return;
    const seatDesc = `Room ${room}, Seat ${seatKey}`;

    // Save original state for rollback
    const originalSeating = systemState.teachers[activeSeatingUsername].seating_info;

    // Optimistic Update
    systemState.teachers[activeSeatingUsername].seating_info = seatDesc;
    updateDashboardView();
    document.getElementById('admin-seating-modal').classList.add('hidden');

    const payload = {
        username: activeSeatingUsername,
        seating_info: seatDesc
    };

    try {
        const res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'allot_seat', payload })
        });
        if (!res.ok) {
            // Rollback
            systemState.teachers[activeSeatingUsername].seating_info = originalSeating;
            updateDashboardView();
            alert('Seat allotment failed.');
        } else {
            syncStateData();
        }
    } catch (e) {
        // Rollback
        systemState.teachers[activeSeatingUsername].seating_info = originalSeating;
        updateDashboardView();
        alert('Server communication error.');
    }
}

// Seating Modal Close Listeners
document.getElementById('close-seating-modal-btn').addEventListener('click', () => {
    document.getElementById('admin-seating-modal').classList.add('hidden');
});
document.getElementById('admin-seating-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('admin-seating-modal')) {
        document.getElementById('admin-seating-modal').classList.add('hidden');
    }
});

window.enableSeatingEdit = function (username) {
    openSeatingModal(username);
};

// Project upload form and choose file listeners
document.addEventListener('DOMContentLoaded', () => {
    const projectSortOption = document.getElementById('project-sort-option');
    if (projectSortOption) {
        projectSortOption.addEventListener('change', updateDashboardView);
    }

    const projectFileTrigger = document.getElementById('project-file-trigger');
    const projectFileInput = document.getElementById('project-file-input');
    const projectFileName = document.getElementById('project-file-name');
    const projectUploadForm = document.getElementById('project-upload-form');

    if (projectFileTrigger && projectFileInput) {
        projectFileTrigger.addEventListener('click', () => projectFileInput.click());
        projectFileInput.addEventListener('change', () => {
            if (projectFileInput.files.length > 0) {
                projectFileName.innerText = projectFileInput.files[0].name;
            } else {
                projectFileName.innerText = 'No file selected';
            }
        });
    }

    if (projectUploadForm) {
        projectUploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const titleInput = document.getElementById('project-title-input');
            if (!titleInput || !projectFileInput.files || projectFileInput.files.length === 0) {
                alert('Please provide both a title and a file.');
                return;
            }

            const file = projectFileInput.files[0];
            const title = titleInput.value.trim();

            const formData = new FormData();
            formData.append('file', file);
            formData.append('title', title);
            formData.append('username', currentUser);

            try {
                const submitBtn = projectUploadForm.querySelector('button[type="submit"]');
                const originalBtnText = submitBtn.innerText;
                submitBtn.disabled = true;
                submitBtn.innerText = 'Uploading...';

                const res = await fetch('/api/projects/upload', {
                    method: 'POST',
                    body: formData
                });

                submitBtn.disabled = false;
                submitBtn.innerText = originalBtnText;

                if (res.ok) {
                    titleInput.value = '';
                    projectFileInput.value = '';
                    projectFileName.innerText = 'No file selected';
                    syncStateData();
                } else {
                    const err = await res.json();
                    alert(`Upload failed: ${err.detail || 'Unknown error'}`);
                }
            } catch (error) {
                alert('Server communication error during project upload.');
            }
        });
    }

    // Leave Application Form Listener
    const leaveFileTrigger = document.getElementById('leave-file-trigger');
    const leaveFileInput = document.getElementById('leave-file-input');
    const leaveFileName = document.getElementById('leave-file-name');

    if (leaveFileTrigger && leaveFileInput) {
        leaveFileTrigger.addEventListener('click', () => leaveFileInput.click());
        leaveFileInput.addEventListener('change', () => {
            if (leaveFileInput.files.length > 0) {
                leaveFileName.innerText = leaveFileInput.files[0].name;
            } else {
                leaveFileName.innerText = 'No file selected';
            }
        });
    }
    const leaveApplicationForm = document.getElementById('leave-application-form');
    if (leaveApplicationForm) {
        leaveApplicationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dateInput = document.getElementById('leave-date-input');
            const typeSelect = document.getElementById('leave-type-select');
            const descInput = document.getElementById('leave-desc-input');
            
            if (!dateInput || !typeSelect || !dateInput.value || !typeSelect.value || !descInput || !descInput.value) {
                alert('Please fill out all required fields.');
                return;
            }
            
            const formData = new FormData();
            formData.append('username', currentUser);
            formData.append('leave_date', dateInput.value);
            formData.append('leave_type', typeSelect.value);
            formData.append('title', typeSelect.value);
            formData.append('description', descInput.value.trim());
            if (leaveFileInput && leaveFileInput.files && leaveFileInput.files.length > 0) {
                formData.append('file', leaveFileInput.files[0]);
            }
            
            try {
                const submitBtn = leaveApplicationForm.querySelector('button[type="submit"]');
                const originalBtnText = submitBtn.innerText;
                submitBtn.disabled = true;
                submitBtn.innerText = 'Submitting...';
                
                const res = await fetch('/api/leaves/apply', {
                    method: 'POST',
                    body: formData
                });
                
                submitBtn.disabled = false;
                submitBtn.innerText = originalBtnText;
                
                if (res.ok) {
                    dateInput.value = '';
                    typeSelect.value = '';
                    descInput.value = '';
                    if (leaveFileInput) leaveFileInput.value = '';
                    if (leaveFileName) leaveFileName.innerText = 'No file selected';
                    syncStateData();
                    alert('Leave application submitted successfully!');
                } else {
                    const err = await res.json();
                    alert(`Submission failed: ${err.detail || 'Unknown error'}`);
                }
            } catch (error) {
                alert('Server communication error during leave application submission.');
            }
        });
    }

    // Profile photo upload form and choose file listeners
    const photoFileTrigger = document.getElementById('photo-file-trigger');
    const photoFileInput = document.getElementById('photo-file-input');
    const photoUploadSubmit = document.getElementById('photo-upload-submit');
    const profilePhotoForm = document.getElementById('profile-photo-form');
    const settingsPhotoPreview = document.getElementById('settings-photo-preview-container');
    const settingsPhotoStatus = document.getElementById('settings-photo-status');

    if (photoFileTrigger && photoFileInput) {
        photoFileTrigger.addEventListener('click', () => photoFileInput.click());
        photoFileInput.addEventListener('change', () => {
            if (photoFileInput.files.length > 0) {
                const file = photoFileInput.files[0];
                photoFileTrigger.innerText = `📁 ${file.name}`;
                photoUploadSubmit.disabled = false;

                const reader = new FileReader();
                reader.onload = (e) => {
                    if (settingsPhotoPreview) {
                        settingsPhotoPreview.innerHTML = `<img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    }
                };
                reader.readAsDataURL(file);
            } else {
                photoFileTrigger.innerText = '📁 Choose Photo';
                photoUploadSubmit.disabled = true;
            }
        });
    }

    if (profilePhotoForm) {
        profilePhotoForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!photoFileInput.files || photoFileInput.files.length === 0) {
                alert('Please select a photo first.');
                return;
            }

            const file = photoFileInput.files[0];
            const formData = new FormData();
            formData.append('file', file);
            formData.append('username', currentUser);

            try {
                photoUploadSubmit.disabled = true;
                const originalBtnText = photoUploadSubmit.innerText;
                photoUploadSubmit.innerText = 'Uploading...';

                const res = await fetch('/api/profile-photo/upload', {
                    method: 'POST',
                    body: formData
                });

                photoUploadSubmit.innerText = originalBtnText;

                if (res.ok) {
                    photoFileInput.value = '';
                    photoFileTrigger.innerText = '📁 Choose Photo';
                    photoUploadSubmit.disabled = true;
                    if (settingsPhotoStatus) settingsPhotoStatus.innerText = "Custom profile photo active";

                    syncStateData();
                    alert('Profile photo uploaded successfully!');
                } else {
                    const err = await res.json();
                    alert(`Photo upload failed: ${err.detail || 'Unknown error'}`);
                    photoUploadSubmit.disabled = false;
                }
            } catch (error) {
                photoUploadSubmit.disabled = false;
                alert('Server communication error during photo upload.');
            }
        });
    }
});


// Academic Calendar Component State & Logic
let calendarYear = 2026; // Current local time year is 2026
let calendarMonth = 6;  // July (0-indexed is 6)
let academicEvents = [];
let publicHolidays = {}; // cache by year
let teacherSchedule = [];
let calendarFilter = 'meetings'; // 'meetings' or 'timetable'

async function initCalendar() {
    const monthSelect = document.getElementById('calendar-month-select');
    const yearSelect = document.getElementById('calendar-year-select');
    const prevBtn = document.getElementById('calendar-prev-month');
    const nextBtn = document.getElementById('calendar-next-month');
    const todayBtn = document.getElementById('calendar-today-btn');

    if (!monthSelect || !yearSelect) return;

    // Populate Year Select
    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 2; y <= currentYear + 2; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.innerText = y;
        if (y === calendarYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }

    // Set Initial values
    monthSelect.value = calendarMonth;
    yearSelect.value = calendarYear;

    // Filter selector and modal initialization
    const filterSelect = document.getElementById('calendar-filter-select');
    if (filterSelect) {
        filterSelect.value = calendarFilter;
        if (!filterSelect.dataset.hasListener) {
            filterSelect.dataset.hasListener = "true";
            filterSelect.addEventListener('change', () => {
                calendarFilter = filterSelect.value;
                renderCalendar();
            });
        }
    }

    const detailModal = document.getElementById('teacher-calendar-detail-modal');
    const closeDetailModalBtn = document.getElementById('close-detail-modal-btn');
    if (detailModal && closeDetailModalBtn && !closeDetailModalBtn.dataset.hasListener) {
        closeDetailModalBtn.dataset.hasListener = "true";
        closeDetailModalBtn.addEventListener('click', () => {
            detailModal.classList.add('hidden');
        });
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) {
                detailModal.classList.add('hidden');
            }
        });
    }

    // Listeners
    if (!monthSelect.dataset.hasListener) {
        monthSelect.dataset.hasListener = "true";
        monthSelect.addEventListener('change', () => {
            calendarMonth = parseInt(monthSelect.value);
            renderCalendar();
        });
    }

    if (!yearSelect.dataset.hasListener) {
        yearSelect.dataset.hasListener = "true";
        yearSelect.addEventListener('change', () => {
            calendarYear = parseInt(yearSelect.value);
            renderCalendar();
        });
    }

    if (!prevBtn.dataset.hasListener) {
        prevBtn.dataset.hasListener = "true";
        prevBtn.addEventListener('click', () => {
            if (calendarMonth === 0) {
                calendarMonth = 11;
                calendarYear--;
                yearSelect.value = calendarYear;
            } else {
                calendarMonth--;
            }
            monthSelect.value = calendarMonth;
            renderCalendar();
        });
    }

    if (!nextBtn.dataset.hasListener) {
        nextBtn.dataset.hasListener = "true";
        nextBtn.addEventListener('click', () => {
            if (calendarMonth === 11) {
                calendarMonth = 0;
                calendarYear++;
                yearSelect.value = calendarYear;
            } else {
                calendarMonth++;
            }
            monthSelect.value = calendarMonth;
            renderCalendar();
        });
    }

    if (!todayBtn.dataset.hasListener) {
        todayBtn.dataset.hasListener = "true";
        todayBtn.addEventListener('click', () => {
            const today = new Date();
            calendarMonth = today.getMonth();
            calendarYear = today.getFullYear();
            monthSelect.value = calendarMonth;
            yearSelect.value = calendarYear;
            renderCalendar();
        });
    }

    // Fetch initial meetings
    try {
        const res = await fetch('/api/calendar/meetings');
        if (res.ok) {
            academicEvents = await res.json();
        }
    } catch (e) {
        console.error('Error fetching meetings:', e);
    }

    // Fetch initial class timetable — use personal schedule if logged in as a teacher
    try {
        const timetableUrl = currentUser ? `/api/calendar/timetable?username=${encodeURIComponent(currentUser)}` : '/api/calendar/timetable';
        const res = await fetch(timetableUrl);
        if (res.ok) {
            teacherSchedule = await res.json();
        }
    } catch (e) {
        console.error('Error fetching timetable:', e);
    }

    // Render calendar
    renderCalendar();
}

async function fetchPublicHolidays(year) {
    if (publicHolidays[year]) return publicHolidays[year];

    const fallbackHolidays = [
        { date: `${year}-01-26`, name: "Republic Day", localName: "Republic Day" },
        { date: `${year}-03-02`, name: "Holi", localName: "Holi" },
        { date: `${year}-04-02`, name: "Good Friday", localName: "Good Friday" },
        { date: `${year}-04-14`, name: "Ambedkar Jayanti", localName: "Ambedkar Jayanti" },
        { date: `${year}-05-01`, name: "May Day", localName: "May Day" },
        { date: `${year}-08-15`, name: "Independence Day", localName: "Independence Day" },
        { date: `${year}-09-04`, name: "Janmashtami", localName: "Janmashtami" },
        { date: `${year}-10-02`, name: "Gandhi Jayanti", localName: "Gandhi Jayanti" },
        { date: `${year}-10-20`, name: "Dussehra", localName: "Dussehra" },
        { date: `${year}-11-08`, name: "Diwali", localName: "Diwali" },
        { date: `${year}-12-25`, name: "Christmas Day", localName: "Christmas Day" }
    ];

    try {
        const res = await fetch(`/api/calendar/holidays`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.length > 0) {
                publicHolidays[year] = data;
                return data;
            }
        }
    } catch (e) {
        console.error(`Error fetching holidays for ${year}:`, e);
    }

    publicHolidays[year] = fallbackHolidays;
    return fallbackHolidays;
}

async function renderCalendar() {
    const daysGrid = document.getElementById('calendar-days-grid');
    if (!daysGrid) return;

    daysGrid.innerHTML = '';

    // Render 7-column header showing Mon - Sun
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    weekdays.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header text-center font-semibold py-2 text-neutral-400 text-sm';
        header.innerText = day;
        daysGrid.appendChild(header);
    });

    // Get holidays for the current calendar year
    const yearHolidays = await fetchPublicHolidays(calendarYear);

    // Optimize Lookup: Pre-group items to avoid array filter lookups in loop
    const meetingsByDate = {};
    academicEvents.forEach(e => {
        const d = e.date || e.event_date;
        if (d) {
            if (!meetingsByDate[d]) meetingsByDate[d] = [];
            meetingsByDate[d].push(e);
        }
    });

    const holidaysByDate = {};
    yearHolidays.forEach(h => {
        const d = h.date;
        if (d) {
            if (!holidaysByDate[d]) holidaysByDate[d] = [];
            holidaysByDate[d].push(h);
        }
    });

    const classesByDay = {};
    teacherSchedule.forEach(c => {
        const day = c.day || c.day_of_week;
        if (day) {
            if (!classesByDay[day]) classesByDay[day] = [];
            classesByDay[day].push(c);
        }
    });

    // Days in current month
    const totalDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();

    // Day index of first day (0 = Sunday, 1 = Monday...) -> map to 0=Mon, 6=Sun
    let firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    // Fill preceding empty cells
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day-cell other-month opacity-20 pointer-events-none w-full aspect-square h-full max-h-full border border-neutral-800 overflow-hidden';
        daysGrid.appendChild(emptyCell);
    }

    // Today's date reference
    const today = new Date();
    const isTodayInActiveMonth = today.getMonth() === calendarMonth && today.getFullYear() === calendarYear;

    // Render cells for days
    for (let day = 1; day <= totalDays; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell w-full aspect-square h-full max-h-full border border-neutral-800/60 rounded relative transition-all overflow-hidden';

        // Check if Sunday
        const dateObj = new Date(calendarYear, calendarMonth, day);
        const isSunday = dateObj.getDay() === 0;
        const weekdayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

        if (isSunday) {
            cell.className += ' sunday bg-neutral-800/30 text-neutral-500 pointer-events-none';
        } else {
            cell.className += ' cursor-pointer hover:bg-neutral-800/30';
        }

        // Highlight current day if active
        if (isTodayInActiveMonth && today.getDate() === day) {
            cell.className += ' calendar-current-day border-2 border-blue-500';
        }

        const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Color code public holiday cells as red
        const dayHolidays = holidaysByDate[dateStr] || [];
        if (dayHolidays.length > 0) {
            cell.className += ' holiday-cell';
        }

        // Add day cell click listener
        if (!isSunday) {
            cell.addEventListener('click', () => {
                const detailModal = document.getElementById('teacher-calendar-detail-modal');
                const titleEl = document.getElementById('detail-modal-title');
                const bodyEl = document.getElementById('detail-modal-body');
                if (!detailModal || !bodyEl || !titleEl) return;

                let html = '';
                if (calendarFilter === 'meetings') {
                    titleEl.innerText = `Schedule for ${dateStr}`;
                    const dayAcademicEvents = meetingsByDate[dateStr] || [];
                    const dayHolidays = holidaysByDate[dateStr] || [];

                    if (dayAcademicEvents.length === 0 && dayHolidays.length === 0) {
                        html = '<p class="text-neutral-400 text-center py-4">No meetings or events scheduled for this day.</p>';
                    } else {
                        dayAcademicEvents.forEach(e => {
                            html += `
                                <div class="p-3 rounded border border-blue-500/20 bg-blue-800/10 flex flex-col gap-1">
                                    <div class="flex justify-between items-center">
                                        <span class="font-bold text-blue-400 text-sm truncate whitespace-nowrap overflow-hidden">${e.title}</span>
                                        <span class="text-xs text-neutral-400">${e.time || ''}</span>
                                    </div>
                                    <span class="text-xs text-neutral-300">${e.description || 'No description'}</span>
                                </div>
                            `;
                        });
                        dayHolidays.forEach(h => {
                            html += `
                                <div class="p-3 rounded border border-red-500/20 bg-red-800/10 flex flex-col gap-1">
                                    <div class="flex justify-between items-center">
                                        <span class="font-bold text-red-400 text-sm truncate whitespace-nowrap overflow-hidden">🌴 ${h.localName || h.name}</span>
                                        <span class="text-xs text-red-400">Public Holiday</span>
                                    </div>
                                </div>
                            `;
                        });
                    }
                } else {
                    titleEl.innerText = `Classes on ${weekdayName} (${dateStr})`;
                    const dayClasses = classesByDay[weekdayName] || [];
                    const dayHolidays = holidaysByDate[dateStr] || [];

                    if (dayHolidays.length > 0) {
                        dayHolidays.forEach(h => {
                            html += `
                                <div class="p-3 rounded border border-red-500/20 bg-red-800/10 mb-2">
                                    <span class="font-bold text-red-400 text-sm truncate whitespace-nowrap overflow-hidden">🌴 Public Holiday: ${h.localName || h.name}</span>
                                </div>
                            `;
                        });
                    }

                    if (dayClasses.length === 0) {
                        html += '<p class="text-neutral-400 text-center py-4">No classes scheduled for ' + weekdayName + '.</p>';
                    } else {
                        dayClasses.forEach(c => {
                            html += `
                                <div class="p-3 rounded border border-purple-500/20 bg-purple-800/10 flex flex-col gap-1">
                                    <div class="flex justify-between items-center">
                                        <span class="font-bold text-purple-400 text-sm truncate whitespace-nowrap overflow-hidden">📖 ${c.subject}</span>
                                        <span class="text-xs text-neutral-400">${c.time}</span>
                                    </div>
                                    <div class="flex justify-between items-center text-xs text-neutral-300">
                                        <span>Classroom: <strong class="text-purple-300">${c.class}</strong></span>
                                    </div>
                                </div>
                            `;
                        });
                    }
                }

                bodyEl.innerHTML = html;
                detailModal.classList.remove('hidden');
            });
        }

        // Inner container absolutely positioned to fill the square cell without stretching it
        const innerContainer = document.createElement('div');
        innerContainer.className = 'absolute inset-0 p-2 flex flex-col justify-between overflow-hidden';

        // Top left number label
        const numberLabel = document.createElement('div');
        numberLabel.className = 'calendar-day-number text-left text-xs font-semibold';
        numberLabel.innerText = day;
        innerContainer.appendChild(numberLabel);

        // Container for events in this cell
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'calendar-events-list flex flex-col gap-1 overflow-y-auto max-h-[80px] mt-1';

        // Public holidays displayed in both views
        const dayHolidaysList = holidaysByDate[dateStr] || [];
        dayHolidaysList.forEach(h => {
            const badge = document.createElement('span');
            badge.className = 'calendar-event-badge calendar-event-holiday bg-red-600/20 text-red-400 px-1.5 py-0.5 rounded text-[10px] block w-full truncate whitespace-nowrap overflow-hidden border border-red-500/30';
            badge.innerText = `🌴 ${h.localName || h.name}`;
            badge.title = h.name;
            eventsContainer.appendChild(badge);
        });

        if (calendarFilter === 'meetings') {
            // Filter academic events / meetings
            const dayAcademicEvents = meetingsByDate[dateStr] || [];
            dayAcademicEvents.forEach(e => {
                const badge = document.createElement('span');
                badge.className = 'calendar-event-badge bg-blue-800/30 text-blue-400 px-1.5 py-0.5 rounded text-[10px] block w-full truncate whitespace-nowrap overflow-hidden border border-blue-500/20';
                badge.innerText = `${e.type === 'meeting' ? '💼' : '🎓'} ${e.title}`;
                badge.title = e.title;
                eventsContainer.appendChild(badge);
            });
        } else {
            // Filter class timetable
            if (!isSunday) {
                const dayClasses = classesByDay[weekdayName] || [];
                dayClasses.forEach(c => {
                    const badge = document.createElement('span');
                    badge.className = 'calendar-event-badge bg-purple-800/30 text-purple-400 px-1.5 py-0.5 rounded text-[10px] block w-full truncate whitespace-nowrap overflow-hidden border border-purple-500/20';
                    badge.innerText = `📖 ${c.subject} (${c.class})`;
                    badge.title = `${c.subject} (${c.class}) - ${c.time}`;
                    eventsContainer.appendChild(badge);
                });
            }
        }

        innerContainer.appendChild(eventsContainer);
        cell.appendChild(innerContainer);
        daysGrid.appendChild(cell);
    }
}


// Admin Calendar Management State & Logic
let adminCalendarYear = 2026;
let adminCalendarMonth = 6; // July
let adminEvents = [];
let adminCalendarFilter = 'meetings'; // 'meetings' or 'timetable'

async function initAdminCalendar() {
    const monthSelect = document.getElementById('admin-calendar-month-select');
    const yearSelect = document.getElementById('admin-calendar-year-select');
    const prevBtn = document.getElementById('admin-calendar-prev-month');
    const nextBtn = document.getElementById('admin-calendar-next-month');
    const todayBtn = document.getElementById('admin-calendar-today-btn');
    const addEventBtn = document.getElementById('admin-add-event-btn');

    if (!monthSelect || !yearSelect) return;

    // Filter selector and modal initialization
    const filterSelect = document.getElementById('admin-calendar-filter-select');
    if (filterSelect) {
        filterSelect.value = adminCalendarFilter;
        
        // Show/hide teacher select container initially
        const teacherFilter = document.getElementById('admin-calendar-teacher-filter-container');
        if (teacherFilter) {
            teacherFilter.style.display = (adminCalendarFilter === 'timetable') ? 'block' : 'none';
        }
        
        if (!filterSelect.dataset.hasListener) {
            filterSelect.dataset.hasListener = "true";
            filterSelect.addEventListener('change', () => {
                adminCalendarFilter = filterSelect.value;
                
                // Show/hide teacher select container on filter change
                if (teacherFilter) {
                    teacherFilter.style.display = (adminCalendarFilter === 'timetable') ? 'block' : 'none';
                }
                
                renderAdminCalendar();
            });
        }
    }

    const timetableModal = document.getElementById('admin-timetable-modal');
    const closeTimetableModalBtn = document.getElementById('close-timetable-modal-btn');
    if (timetableModal && closeTimetableModalBtn && !closeTimetableModalBtn.dataset.hasListener) {
        closeTimetableModalBtn.dataset.hasListener = "true";
        closeTimetableModalBtn.addEventListener('click', () => {
            timetableModal.classList.add('hidden');
        });
        timetableModal.addEventListener('click', (e) => {
            if (e.target === timetableModal) {
                timetableModal.classList.add('hidden');
            }
        });
    }

    setupAdminTimetableFormListener();

    // Populate Year Select
    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 2; y <= currentYear + 2; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.innerText = y;
        if (y === adminCalendarYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }

    // Set Initial values
    monthSelect.value = adminCalendarMonth;
    yearSelect.value = adminCalendarYear;

    // Listeners
    if (!monthSelect.dataset.hasListener) {
        monthSelect.dataset.hasListener = "true";
        monthSelect.addEventListener('change', () => {
            adminCalendarMonth = parseInt(monthSelect.value);
            renderAdminCalendar();
        });
    }

    if (!yearSelect.dataset.hasListener) {
        yearSelect.dataset.hasListener = "true";
        yearSelect.addEventListener('change', () => {
            adminCalendarYear = parseInt(yearSelect.value);
            renderAdminCalendar();
        });
    }

    if (!prevBtn.dataset.hasListener) {
        prevBtn.dataset.hasListener = "true";
        prevBtn.addEventListener('click', () => {
            if (adminCalendarMonth === 0) {
                adminCalendarMonth = 11;
                adminCalendarYear--;
                yearSelect.value = adminCalendarYear;
            } else {
                adminCalendarMonth--;
            }
            monthSelect.value = adminCalendarMonth;
            renderAdminCalendar();
        });
    }

    if (!nextBtn.dataset.hasListener) {
        nextBtn.dataset.hasListener = "true";
        nextBtn.addEventListener('click', () => {
            if (adminCalendarMonth === 11) {
                adminCalendarMonth = 0;
                adminCalendarYear++;
                yearSelect.value = adminCalendarYear;
            } else {
                adminCalendarMonth++;
            }
            monthSelect.value = adminCalendarMonth;
            renderAdminCalendar();
        });
    }

    if (!todayBtn.dataset.hasListener) {
        todayBtn.dataset.hasListener = "true";
        todayBtn.addEventListener('click', () => {
            const today = new Date();
            adminCalendarMonth = today.getMonth();
            adminCalendarYear = today.getFullYear();
            monthSelect.value = adminCalendarMonth;
            yearSelect.value = adminCalendarYear;
            renderAdminCalendar();
        });
    }

    if (!addEventBtn.dataset.hasListener) {
        addEventBtn.dataset.hasListener = "true";
        addEventBtn.addEventListener('click', () => {
            const todayStr = `${adminCalendarYear}-${String(adminCalendarMonth + 1).padStart(2, '0')}-01`;
            openCalendarEventModal(null, todayStr);
        });
    }

    // Modal forms listeners
    setupCalendarEventModalListeners();

    // Fetch initial academic events
    await fetchAdminEvents();

    // Reset teacherSchedule for admin timetable select
    teacherSchedule = [];

    // Initialize the calendar teacher search dropdown
    initAdminCalendarTeacherDropdown();

    // Render calendar
    renderAdminCalendar();
}

async function fetchAdminEvents() {
    try {
        const res = await fetch('/api/calendar/meetings');
        if (res.ok) {
            adminEvents = await res.json();
            // Sync with local teacher view calendar
            academicEvents = adminEvents;
        }
    } catch (e) {
        console.error('Error fetching admin events:', e);
    }
}

async function renderAdminCalendar() {
    const daysGrid = document.getElementById('admin-calendar-days-grid');
    if (!daysGrid) return;

    daysGrid.innerHTML = '';

    // Render 7-column header showing Mon - Sun
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    weekdays.forEach(day => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header text-center font-semibold py-2 text-neutral-400 text-sm';
        header.innerText = day;
        daysGrid.appendChild(header);
    });

    // Get holidays for the current calendar year
    const yearHolidays = await fetchPublicHolidays(adminCalendarYear);

    // Optimize Lookup: Pre-group items to avoid array filter lookups in loop
    const meetingsByDate = {};
    adminEvents.forEach(e => {
        const d = e.date || e.event_date;
        if (d) {
            if (!meetingsByDate[d]) meetingsByDate[d] = [];
            meetingsByDate[d].push(e);
        }
    });

    const holidaysByDate = {};
    yearHolidays.forEach(h => {
        const d = h.date;
        if (d) {
            if (!holidaysByDate[d]) holidaysByDate[d] = [];
            holidaysByDate[d].push(h);
        }
    });

    const classesByDay = {};
    teacherSchedule.forEach(c => {
        const day = c.day || c.day_of_week;
        if (day) {
            if (!classesByDay[day]) classesByDay[day] = [];
            classesByDay[day].push(c);
        }
    });

    // Days in current month
    const totalDays = new Date(adminCalendarYear, adminCalendarMonth + 1, 0).getDate();

    // Day index of first day (0 = Sunday, 1 = Monday...) -> map to 0=Mon, 6=Sun
    let firstDayIndex = new Date(adminCalendarYear, adminCalendarMonth, 1).getDay();
    firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    // Fill preceding empty cells
    for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day-cell other-month opacity-20 pointer-events-none w-full aspect-square h-full max-h-full border border-neutral-800 overflow-hidden';
        daysGrid.appendChild(emptyCell);
    }

    // Today's date reference
    const today = new Date();
    const isTodayInActiveMonth = today.getMonth() === adminCalendarMonth && today.getFullYear() === adminCalendarYear;

    // Render cells for days
    for (let day = 1; day <= totalDays; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell admin-day-cell w-full aspect-square h-full max-h-full border border-neutral-800/60 rounded relative transition-all overflow-hidden';

        // Check if Sunday
        const dateObj = new Date(adminCalendarYear, adminCalendarMonth, day);
        const isSunday = dateObj.getDay() === 0;

        if (isSunday) {
            cell.className += ' sunday bg-neutral-800/30 text-neutral-500 pointer-events-none';
        }

        // Highlight current day if active
        if (isTodayInActiveMonth && today.getDate() === day) {
            cell.className += ' calendar-current-day border-2 border-blue-500';
        }

        const dateStr = `${adminCalendarYear}-${String(adminCalendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Color code public holiday cells as red
        const dayHolidays = holidaysByDate[dateStr] || [];
        if (dayHolidays.length > 0) {
            cell.className += ' holiday-cell';
        }

        const weekdayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

        // Clicking on the cell opens appropriate config modal
        if (!isSunday) {
            cell.addEventListener('click', (e) => {
                // If clicking an event badge, don't trigger cell click
                if (e.target.closest('.admin-event-badge')) return;

                if (adminCalendarFilter === 'meetings') {
                    openCalendarEventModal(null, dateStr);
                } else {
                    openAdminTimetableModal(weekdayName);
                }
            });
        }

        // Inner container absolutely positioned to fill the square cell without stretching it
        const innerContainer = document.createElement('div');
        innerContainer.className = 'absolute inset-0 p-2 flex flex-col justify-between overflow-hidden';

        // Top left number label
        const numberLabel = document.createElement('div');
        numberLabel.className = 'calendar-day-number text-left text-xs font-semibold';
        numberLabel.innerText = day;
        innerContainer.appendChild(numberLabel);

        // Container for events in this cell
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'calendar-events-list flex flex-col gap-1 overflow-y-auto max-h-[80px] mt-1';

        // Public holidays displayed in both views
        const dayHolidaysList = holidaysByDate[dateStr] || [];
        dayHolidaysList.forEach(h => {
            const badge = document.createElement('span');
            badge.className = 'calendar-event-badge calendar-event-holiday bg-red-600/20 text-red-400 px-1.5 py-0.5 rounded text-[10px] block w-full truncate whitespace-nowrap overflow-hidden border border-red-500/30';
            badge.innerText = `🌴 ${h.localName || h.name}`;
            badge.title = h.name;
            eventsContainer.appendChild(badge);
        });

        if (adminCalendarFilter === 'meetings') {
            // Filter academic events / meetings
            const dayAcademicEvents = meetingsByDate[dateStr] || [];
            dayAcademicEvents.forEach(e => {
                const badge = document.createElement('span');
                badge.className = 'calendar-event-badge admin-event-badge bg-blue-800/30 text-blue-400 px-1.5 py-0.5 rounded text-[10px] block w-full truncate whitespace-nowrap overflow-hidden border border-blue-500/20';
                badge.innerText = `${e.type === 'meeting' ? '💼' : '🎓'} ${e.title}`;
                badge.title = e.title;

                // Edit event on click
                badge.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    openCalendarEventModal(e);
                });
                eventsContainer.appendChild(badge);
            });
        } else {
            // Filter class timetable
            if (!isSunday) {
                const dayClasses = classesByDay[weekdayName] || [];
                dayClasses.forEach(c => {
                    const badge = document.createElement('span');
                    badge.className = 'calendar-event-badge admin-event-badge bg-purple-800/30 text-purple-400 px-1.5 py-0.5 rounded text-[10px] block w-full truncate whitespace-nowrap overflow-hidden border border-purple-500/20';
                    badge.innerText = `📖 ${c.subject} (${c.class})`;
                    badge.title = `${c.subject} (${c.class}) - ${c.time}`;

                    // Clicking class timetable item will also open timetable management modal
                    badge.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        openAdminTimetableModal(weekdayName);
                    });
                    eventsContainer.appendChild(badge);
                });
            }
        }

        innerContainer.appendChild(eventsContainer);
        cell.appendChild(innerContainer);
        daysGrid.appendChild(cell);
    }
}

function updateEventDeptLabel() {
    const checkboxes = document.querySelectorAll('.dept-checkbox:checked');
    const allChecked = document.getElementById('dept-all').checked;
    const label = document.getElementById('event-dept-label');
    if (!label) return;

    if (allChecked) {
        label.innerText = 'All Departments';
    } else if (checkboxes.length === 0) {
        label.innerText = 'Select Depts';
    } else if (checkboxes.length === document.querySelectorAll('.dept-checkbox').length) {
        document.getElementById('dept-all').checked = true;
        label.innerText = 'All Departments';
    } else {
        const names = Array.from(checkboxes).map(cb => {
            const val = cb.value;
            if (val.includes('&')) {
                // Shorten names for label if needed
                return val.split(' ')[0];
            }
            return val;
        });
        label.innerText = names.join(', ');
    }
}

function openCalendarEventModal(eventObj = null, defaultDateStr = null) {
    const modal = document.getElementById('admin-calendar-event-modal');
    const modalTitle = document.getElementById('event-modal-title');
    const deleteBtn = document.getElementById('event-delete-btn');

    const eventIdInput = document.getElementById('event-id');
    const titleInput = document.getElementById('event-title');
    const dateInput = document.getElementById('event-date');
    const timeInput = document.getElementById('event-time');
    const typeInput = document.getElementById('event-type');
    const descInput = document.getElementById('event-description');

    if (!modal) return;

    const allCheckbox = document.getElementById('dept-all');
    const deptCheckboxes = document.querySelectorAll('.dept-checkbox');

    if (eventObj) {
        modalTitle.innerText = "Edit Academic Event";
        deleteBtn.classList.remove('hidden');

        eventIdInput.value = eventObj.id || '';
        titleInput.value = eventObj.title || '';
        dateInput.value = eventObj.date || '';
        timeInput.value = eventObj.time || '';
        typeInput.value = eventObj.type || 'meeting';
        descInput.value = eventObj.description || '';

        let depts = [];
        if (eventObj.departments) {
            depts = eventObj.departments;
        } else if (eventObj.department) {
            depts = eventObj.department.split(',').map(d => d.trim()).filter(Boolean);
        }

        const isAll = depts.includes('All') || depts.length === deptCheckboxes.length;
        if (allCheckbox) allCheckbox.checked = isAll;
        deptCheckboxes.forEach(cb => {
            cb.checked = isAll || depts.includes(cb.value);
        });
    } else {
        modalTitle.innerText = "Add Academic Event";
        deleteBtn.classList.add('hidden');

        eventIdInput.value = '';
        titleInput.value = '';
        dateInput.value = defaultDateStr || '';
        timeInput.value = '10:00';
        typeInput.value = 'meeting';
        descInput.value = '';

        if (allCheckbox) allCheckbox.checked = true;
        deptCheckboxes.forEach(cb => {
            cb.checked = true;
        });
    }

    updateEventDeptLabel();
    modal.classList.remove('hidden');
}

function setupCalendarEventModalListeners() {
    const modal = document.getElementById('admin-calendar-event-modal');
    const closeBtn = document.getElementById('close-event-modal-btn');
    const deleteBtn = document.getElementById('event-delete-btn');
    const form = document.getElementById('admin-event-form');

    if (!modal) return;

    // Dropdown toggling logic
    const deptToggle = document.getElementById('event-dept-toggle');
    const deptOptions = document.getElementById('event-dept-options');
    if (deptToggle && deptOptions && !deptToggle.dataset.hasListener) {
        deptToggle.dataset.hasListener = "true";
        deptToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            deptOptions.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#event-dept-dropdown')) {
                deptOptions.classList.add('hidden');
            }
        });
    }

    // Checkbox toggling logic
    const allCheckbox = document.getElementById('dept-all');
    const deptCheckboxes = document.querySelectorAll('.dept-checkbox');

    if (allCheckbox && !allCheckbox.dataset.hasListener) {
        allCheckbox.dataset.hasListener = "true";
        allCheckbox.addEventListener('change', () => {
            const checked = allCheckbox.checked;
            deptCheckboxes.forEach(cb => {
                cb.checked = checked;
            });
            updateEventDeptLabel();
        });
    }

    deptCheckboxes.forEach(cb => {
        if (!cb.dataset.hasListener) {
            cb.dataset.hasListener = "true";
            cb.addEventListener('change', () => {
                const totalDepts = deptCheckboxes.length;
                const checkedDepts = document.querySelectorAll('.dept-checkbox:checked').length;
                allCheckbox.checked = (totalDepts === checkedDepts);
                updateEventDeptLabel();
            });
        }
    });

    if (!closeBtn.dataset.hasListener) {
        closeBtn.dataset.hasListener = "true";
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }

    if (!deleteBtn.dataset.hasListener) {
        deleteBtn.dataset.hasListener = "true";
        deleteBtn.addEventListener('click', async () => {
            const eventId = document.getElementById('event-id').value;
            if (!eventId) return;

            const verify = confirm("Are you sure you want to delete this scheduled event?");
            if (!verify) return;

            try {
                const res = await fetch(`/api/calendar/meetings/${eventId}`, {
                    method: 'DELETE'
                });
                if (res.ok) {
                    modal.classList.add('hidden');
                    await fetchAdminEvents();
                    renderAdminCalendar();
                } else {
                    alert('Failed to delete event.');
                }
            } catch (e) {
                alert('Network error while deleting event.');
            }
        });
    }

    if (!form.dataset.hasListener) {
        form.dataset.hasListener = "true";
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const eventId = document.getElementById('event-id').value;

            const checkedDepts = [];
            if (document.getElementById('dept-all').checked) {
                checkedDepts.push('All');
            } else {
                document.querySelectorAll('.dept-checkbox:checked').forEach(cb => {
                    checkedDepts.push(cb.value);
                });
            }

            const payload = {
                title: document.getElementById('event-title').value.trim(),
                date: document.getElementById('event-date').value,
                time: document.getElementById('event-time').value,
                type: document.getElementById('event-type').value,
                departments: checkedDepts,
                department: checkedDepts.join(', '),
                description: document.getElementById('event-description').value.trim()
            };

            const method = eventId ? 'PUT' : 'POST';
            if (eventId) {
                payload.id = eventId;
            }

            try {
                const url = eventId ? `/api/calendar/meetings/${eventId}` : '/api/calendar/meetings';
                const res = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    modal.classList.add('hidden');
                    await fetchAdminEvents();
                    renderAdminCalendar();
                } else {
                    const err = await res.json();
                    let msg = 'Unknown error';
                    if (err.detail) {
                        if (Array.isArray(err.detail)) {
                            msg = err.detail.map(d => `${d.loc ? d.loc.join('.') : 'field'}: ${d.msg}`).join('\n');
                        } else {
                            msg = err.detail;
                        }
                    }
                    alert(`Failed to save event:\n${msg}`);
                }
            } catch (e) {
                alert('Network error while saving event.');
            }
        });
    }
}

function openAdminTimetableModal(clickedDayName = 'Monday') {
    const selectedTeacher = document.getElementById('admin-calendar-selected-teacher-username').value;
    if (!selectedTeacher) {
        alert('Please select a teacher in the calendar first.');
        return;
    }

    const modal = document.getElementById('admin-timetable-modal');
    if (!modal) return;

    // Set the hidden selected day
    const dayInput = document.getElementById('timetable-selected-day');
    if (dayInput) {
        dayInput.value = clickedDayName;
    }

    // Populate current timetable sessions list for the already-selected teacher
    renderAdminTimetableSessionsList();

    modal.classList.remove('hidden');
}

function initAdminCalendarTeacherDropdown() {
    const searchInput = document.getElementById('admin-calendar-teacher-search');
    const dropdownList = document.getElementById('admin-calendar-teacher-dropdown-list');
    const hiddenSelect = document.getElementById('admin-calendar-selected-teacher-username');
    if (!searchInput || !dropdownList || !hiddenSelect || !systemState || !systemState.teachers) return;

    const teachers = Object.keys(systemState.teachers).map(uname => {
        return { username: uname, ...systemState.teachers[uname] };
    });

    const renderList = (filterText = '') => {
        dropdownList.innerHTML = '';
        
        // Include a 'Select' option at the top of the list
        const selectItem = document.createElement('div');
        selectItem.style.padding = '10px 14px';
        selectItem.style.cursor = 'pointer';
        selectItem.style.fontSize = '0.9rem';
        selectItem.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
        selectItem.innerHTML = `<span style="font-weight: 500; color: #888;">Select Teacher</span>`;
        selectItem.addEventListener('click', () => {
            searchInput.value = 'Select';
            hiddenSelect.value = '';
            dropdownList.style.display = 'none';
            onAdminCalendarTeacherSelected('');
        });
        selectItem.addEventListener('mouseenter', () => selectItem.style.background = 'rgba(255, 255, 255, 0.05)');
        selectItem.addEventListener('mouseleave', () => selectItem.style.background = 'transparent');
        dropdownList.appendChild(selectItem);

        const filtered = teachers.filter(t => {
            const name = (t.name || '').toLowerCase();
            const empId = (t.employee_id || '').toLowerCase();
            const search = filterText.toLowerCase();
            return name.includes(search) || empId.includes(search);
        });

        filtered.forEach(t => {
            const item = document.createElement('div');
            item.style.padding = '10px 14px';
            item.style.cursor = 'pointer';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.fontSize = '0.9rem';
            item.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
            item.className = 'teacher-dropdown-item';

            item.innerHTML = `
                <span style="font-weight: 500; color: #fff;">${t.name || t.username}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${t.employee_id || 'No ID'}</span>
            `;

            item.addEventListener('click', () => {
                searchInput.value = t.name || t.username;
                hiddenSelect.value = t.username;
                dropdownList.style.display = 'none';
                onAdminCalendarTeacherSelected(t.username);
            });

            item.addEventListener('mouseenter', () => {
                item.style.background = 'rgba(255, 255, 255, 0.05)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
            });

            dropdownList.appendChild(item);
        });
    };

    if (!searchInput.dataset.hasListener) {
        searchInput.dataset.hasListener = "true";
        searchInput.addEventListener('focus', () => {
            if (searchInput.value === 'Select') {
                searchInput.value = '';
            }
            dropdownList.style.display = 'block';
            renderList(searchInput.value);
        });

        searchInput.addEventListener('input', () => {
            dropdownList.style.display = 'block';
            renderList(searchInput.value);
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !dropdownList.contains(e.target)) {
                dropdownList.style.display = 'none';
                if (!hiddenSelect.value) {
                    searchInput.value = 'Select';
                }
            }
        });
    }

    if (!hiddenSelect.value) {
        searchInput.value = 'Select';
    }
}

function onAdminCalendarTeacherSelected(username) {
    if (username && systemState && systemState.teachers && systemState.teachers[username]) {
        teacherSchedule = systemState.teachers[username].schedule || [];
    } else {
        teacherSchedule = [];
    }
    renderAdminCalendar();
}

function onTimetableTeacherSelected(username) {
    if (!systemState || !systemState.teachers || !systemState.teachers[username]) return;

    const teacher = systemState.teachers[username];
    teacherSchedule = teacher.schedule || [];

    // Update the Current Timetable list below
    renderAdminTimetableSessionsList();
}

function formatTimeInputToAmPm(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    return `${String(formattedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

function renderAdminTimetableSessionsList() {
    const listContainer = document.getElementById('timetable-sessions-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    if (teacherSchedule.length === 0) {
        listContainer.innerHTML = '<p class="text-neutral-400 text-xs text-center py-2">No sessions scheduled.</p>';
        return;
    }

    teacherSchedule.forEach((s, idx) => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center bg-neutral-800/50 p-2 rounded border border-neutral-700/50 text-xs';
        item.innerHTML = `
            <div>
                <strong class="text-purple-400">${s.subject || 'Lecture'}</strong> (${s.class})
                <div class="text-[10px] text-neutral-400">${s.day} | ${s.time}</div>
            </div>
            <button class="btn-delete-session px-2 py-1 bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-300 rounded border border-red-500/20 font-semibold" style="cursor:pointer;" onclick="deleteTimetableSession(${idx})">Delete</button>
        `;
        listContainer.appendChild(item);
    });
}

async function deleteTimetableSession(index) {
    const verify = confirm("Are you sure you want to delete this class session?");
    if (!verify) return;

    // Remove the item
    teacherSchedule.splice(index, 1);

    // Call endpoint to save
    await saveTeacherSchedule();
    renderAdminTimetableSessionsList();
    renderAdminCalendar();
    // Also update candidate calendar if active
    renderCalendar();
}
window.deleteTimetableSession = deleteTimetableSession;

async function saveTeacherSchedule() {
    const selectedTeacher = document.getElementById('admin-calendar-selected-teacher-username').value;
    if (!selectedTeacher) {
        alert('Please select a teacher in the calendar first.');
        return;
    }
    try {
        const res = await fetch('/api/teacher/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                teacher_username: selectedTeacher,
                schedule: teacherSchedule
            })
        });
        if (!res.ok) {
            alert('Failed to save teacher schedule to backend.');
        } else {
            if (systemState && systemState.teachers && systemState.teachers[selectedTeacher]) {
                systemState.teachers[selectedTeacher].schedule = [...teacherSchedule];
            }
        }
    } catch (e) {
        console.error('Error saving teacher schedule:', e);
        alert('Network error while saving schedule.');
    }
}

function setupAdminTimetableFormListener() {
    const form = document.getElementById('admin-timetable-form');
    if (!form) return;

    const startTimeInput = document.getElementById('timetable-start-time');
    const endTimeInput = document.getElementById('timetable-end-time');
    if (startTimeInput && endTimeInput && !startTimeInput.dataset.hasListener) {
        startTimeInput.dataset.hasListener = "true";
        startTimeInput.addEventListener('change', () => {
            const val = startTimeInput.value;
            if (!val) return;
            const [hours, minutes] = val.split(':').map(Number);
            let endHours = hours + 1;
            if (endHours >= 24) endHours -= 24;
            const endVal = `${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            endTimeInput.value = endVal;
        });
    }

    if (!form.dataset.hasListener) {
        form.dataset.hasListener = "true";
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const teacherSelect = document.getElementById('admin-calendar-selected-teacher-username').value;
            if (!teacherSelect) {
                alert('Please select a teacher in the calendar first.');
                return;
            }

            const startTime = document.getElementById('timetable-start-time').value;
            const endTime = document.getElementById('timetable-end-time').value;
            const classroom = document.getElementById('timetable-classroom').value;
            const day = document.getElementById('timetable-selected-day').value || 'Monday';

            if (!startTime || !endTime) {
                alert('Please select start and end times.');
                return;
            }

            const formattedTime = `${formatTimeInputToAmPm(startTime)} - ${formatTimeInputToAmPm(endTime)}`;

            teacherSchedule.push({
                day: day,
                time: formattedTime,
                class: classroom,
                subject: 'Lecture'
            });

            await saveTeacherSchedule();

            document.getElementById('timetable-start-time').value = '';
            document.getElementById('timetable-end-time').value = '';

            renderAdminTimetableSessionsList();
            renderAdminCalendar();
            renderCalendar();

            alert('Timetable session saved successfully!');
        });
    }
}

// ==========================================
// BANK DETAILS & SALARY HISTORY LOGIC
// ==========================================

function toggleBankInputs(disabled) {
    document.getElementById('bank-account-name').disabled = disabled;
    document.getElementById('bank-account-number').disabled = disabled;
    document.getElementById('bank-ifsc').disabled = disabled;
    const saveBtn = document.getElementById('bank-save-btn');
    if(saveBtn) saveBtn.style.display = disabled ? 'none' : 'block';
}

async function loadBankDetails() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/teacher/${currentUser}/bank`);
        if (res.ok) {
            const data = await res.json();
            if (data.bank_details && data.bank_details.account_number) {
                document.getElementById('bank-account-name').value = data.bank_details.account_name || '';
                document.getElementById('bank-account-number').value = data.bank_details.account_number || '';
                document.getElementById('bank-ifsc').value = data.bank_details.ifsc_code || '';
                toggleBankInputs(true);
            } else {
                toggleBankInputs(false);
            }
        }
    } catch (e) {
        console.error("Failed to load bank details", e);
    }
}

async function loadSalaryHistory() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/teacher/${currentUser}/salary`);
        if (res.ok) {
            const data = await res.json();
            const tbody = document.getElementById('salary-history-body');
            tbody.innerHTML = '';
            
            if (data.history && data.history.length > 0) {
                data.history.forEach(record => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${record.month}</td>
                        <td style="color: #3fb950; font-weight: 500;">${record.amount}</td>
                        <td style="font-family: monospace; color: #8b949e;">${record.transaction_id}</td>
                        <td><span class="badge" style="background: rgba(46, 160, 67, 0.15); color: #3fb950; border: 1px solid rgba(46, 160, 67, 0.4);">${record.status}</span></td>
                    `;
                    tbody.appendChild(tr);
                });
            } else {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No salary history available.</td></tr>';
            }
        }
    } catch (e) {
        console.error("Failed to load salary history", e);
    }
}

// HR Salary Management Logic
async function loadHrSalaryList() {
    try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error('Failed to fetch state');
        const data = await res.json();
        
        const tbody = document.getElementById('hr-salary-list-body');
        if(!tbody) return;
        tbody.innerHTML = '';
        
        if (!data.teachers || Object.keys(data.teachers).length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No teachers found.</td></tr>';
            return;
        }

        const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM
        const BASE_WORKING_DAYS = data.global_working_days !== undefined ? data.global_working_days : 26;
        const PER_DAY_WAGE = 3400;

        for (const [username, details] of Object.entries(data.teachers)) {
            // Apply search filter
            const searchInput = document.getElementById('hr-salary-search');
            const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
            const tName = (details.name || '').toLowerCase();
            const tId = (details.emp_id || username).toLowerCase();
            if (searchTerm && !tName.includes(searchTerm) && !tId.includes(searchTerm)) continue;

            // Calculate present/absent from actual attendance records for this month
            let absentThisMonth = 0;
            let presentThisMonth = 0;
            (details.attendance || []).forEach(a => {
                if (a.date && a.date.startsWith(currentMonth)) {
                    if (a.status === 'Present') presentThisMonth++;
                    else if (a.status === 'Absent') absentThisMonth++;
                }
            });
            // Fallback to stored field if no current-month attendance entries yet
            const presentDays = presentThisMonth > 0
                ? presentThisMonth
                : (details.present_days !== undefined ? details.present_days : BASE_WORKING_DAYS - absentThisMonth);
            const netSalary = presentDays * PER_DAY_WAGE;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${details.name || username}</td>
                <td>${details.emp_id || username}</td>
                <td style="color: #f85149; font-weight: 600;">${absentThisMonth}</td>
                <td style="color: #3fb950; font-weight: 600;">${presentDays}</td>
                <td style="font-weight: 500;">₹ ${netSalary.toLocaleString()}</td>
                <td style="text-align: center;">
                    <input type="checkbox" class="salary-select-cb"
                        data-username="${username}"
                        data-salary="${netSalary}"
                        style="width: 16px; height: 16px; accent-color: #58a6ff; cursor: pointer;">
                </td>
            `;
            tbody.appendChild(tr);
        }

        // Select All toggle
        const selectAllCb = document.getElementById('salary-select-all');
        if (selectAllCb) {
            const newCb = selectAllCb.cloneNode(true); // remove old listeners
            selectAllCb.parentNode.replaceChild(newCb, selectAllCb);
            newCb.checked = false;
            newCb.addEventListener('change', (e) => {
                document.querySelectorAll('.salary-select-cb').forEach(cb => cb.checked = e.target.checked);
            });
        }

        // Bulk Push Salary button
        const bulkBtn = document.getElementById('bulk-push-salary-btn');
        if (bulkBtn) {
            const newBtn = bulkBtn.cloneNode(true); // remove old listeners
            bulkBtn.parentNode.replaceChild(newBtn, bulkBtn);
            newBtn.addEventListener('click', async () => {
                const selected = [...document.querySelectorAll('.salary-select-cb:checked')];
                if (selected.length === 0) {
                    alert('Please select at least one teacher to push salary.');
                    return;
                }
                newBtn.disabled = true;
                newBtn.innerText = `Pushing (0/${selected.length})...`;
                const monthStr = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

                let pushed = 0;
                for (const cb of selected) {
                    const targetUsername = cb.dataset.username;
                    const salary = cb.dataset.salary;
                    try {
                        await fetch('/api/hr/salary/push', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                username: targetUsername,
                                amount: `₹ ${parseInt(salary).toLocaleString()}`,
                                month: monthStr
                            })
                        });
                        pushed++;
                        newBtn.innerText = `Pushing (${pushed}/${selected.length})...`;
                    } catch (err) {
                        console.error(`Failed to push salary for ${targetUsername}`, err);
                    }
                }

                newBtn.disabled = false;
                newBtn.innerText = 'Push Salary';
                const selectAll = document.getElementById('salary-select-all');
                if (selectAll) selectAll.checked = false;
                await loadHrSalaryList();
            });
        }

    } catch (e) {
        console.error("Failed to load HR salary list", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const bankForm = document.getElementById('bank-details-form');
    if (bankForm) {
        bankForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser) return;
            
            const submitBtn = document.getElementById('bank-save-btn');
            const originalText = submitBtn.innerText;
            submitBtn.innerText = 'Saving...';
            submitBtn.disabled = true;
            
            const payload = {
                account_name: document.getElementById('bank-account-name').value,
                account_number: document.getElementById('bank-account-number').value,
                ifsc_code: document.getElementById('bank-ifsc').value,
                bank_name: "Union Bank" // Defaulting backend value
            };
            
            try {
                const res = await fetch(`/api/teacher/${currentUser}/bank`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (res.ok) {
                    submitBtn.innerText = 'Saved';
                    setTimeout(() => { submitBtn.innerText = originalText; }, 2000);
                    toggleBankInputs(true);
                } else {
                    alert('Failed to update bank details.');
                    submitBtn.innerText = originalText;
                }
            } catch (err) {
                console.error(err);
                alert('Error updating bank details.');
                submitBtn.innerText = originalText;
            } finally {
                submitBtn.disabled = false;
            }
        });
        
        const editBtn = document.getElementById('bank-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                toggleBankInputs(false);
            });
        }
    }

    // Add listener to the bank tab to load data when clicked
    const bankTabBtn = document.querySelector('.nav-tab[data-tab="candidate-bank"]');
    if (bankTabBtn) {
        bankTabBtn.addEventListener('click', () => {
            loadBankDetails();
            loadSalaryHistory();
        });
    }
    
    // Add listener for HR salary tab
    const hrSalaryTabBtn = document.querySelector('.nav-tab[data-tab="hr-salary"]');
    if (hrSalaryTabBtn) {
        hrSalaryTabBtn.addEventListener('click', () => {
            loadHrSalaryList();
        });
    }
    
    // Add listener for HR salary search input
    const hrSalarySearch = document.getElementById('hr-salary-search');
    if (hrSalarySearch) {
        hrSalarySearch.addEventListener('input', () => {
            loadHrSalaryList();
        });
    }

    // Add listener for HR OCR Upload Form
    const hrOcrUploadForm = document.getElementById('hr-ocr-upload-form');
    if (hrOcrUploadForm) {
        hrOcrUploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dateInput = document.getElementById('hr-ocr-date');
            const fileInput = document.getElementById('hr-ocr-file');
            const statusDiv = document.getElementById('hr-ocr-status');
            
            if (!dateInput.value || !fileInput.files[0]) {
                alert('Please select a date and file.');
                return;
            }
            
            statusDiv.innerHTML = '<span style="color: #58a6ff;">Processing OCR... Please wait.</span>';
            
            const formData = new FormData();
            formData.append('date', dateInput.value);
            formData.append('file', fileInput.files[0]);
            
            try {
                const response = await fetch('/api/attendance/ocr-upload', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                if (response.ok && result.status === 'success') {
                    statusDiv.innerHTML = `<span style="color: #2ea043;">OCR Completed successfully! Extracted ${result.extracted_records.length} records.</span>`;
                    fileInput.value = '';
                    
                    // Reload state to refresh teacher dashboard views and lists
                    const stateRes = await fetch('/api/state');
                    systemState = await stateRes.json();
                    updateDashboardView();
                } else {
                    statusDiv.innerHTML = `<span style="color: #f85149;">Error: ${result.detail || 'Failed to process OCR'}</span>`;
                }
            } catch (err) {
                console.error(err);
                statusDiv.innerHTML = `<span style="color: #f85149;">Network error or server failed to respond.</span>`;
            }
        });
    }
});

// FORGOT PASSWORD FLOW
const fpLink = document.getElementById('forgot-password-link');
const fpModal = document.getElementById('forgot-password-modal');
const fpStep1 = document.getElementById('fp-step-1');
const fpStep2 = document.getElementById('fp-step-2');
const fpStep3 = document.getElementById('fp-step-3');
const fpUsername = document.getElementById('fp-username');
const fpRequestBtn = document.getElementById('fp-request-btn');
const fpCode = document.getElementById('fp-code');
const fpValidateBtn = document.getElementById('fp-validate-btn');
const fpNewPassword = document.getElementById('fp-new-password');
const fpResetBtn = document.getElementById('fp-reset-btn');
const fpCloseBtn = document.getElementById('fp-close-btn');

if (fpLink) {
    fpLink.addEventListener('click', (e) => {
        e.preventDefault();
        fpModal.classList.remove('hidden');
        fpStep1.classList.remove('hidden');
        fpStep2.classList.add('hidden');
        if (fpStep3) fpStep3.classList.add('hidden');
        if (fpValidateBtn) fpValidateBtn.classList.remove('hidden');
        if (fpCode) fpCode.disabled = false;
        fpUsername.value = '';
        fpCode.value = '';
        fpNewPassword.value = '';
    });
}

if (fpCloseBtn) {
    fpCloseBtn.addEventListener('click', () => {
        fpModal.classList.add('hidden');
    });
}

if (fpRequestBtn) {
    fpRequestBtn.addEventListener('click', async () => {
        const username = fpUsername.value.trim();
        if (!username) return alert('Please enter a username');
        try {
            fpRequestBtn.disabled = true;
            fpRequestBtn.innerText = 'Sending...';
            const res = await fetch('/api/forgot-password', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username})
            });
            const data = await res.json();
            if (res.ok) {
                fpStep1.classList.add('hidden');
                fpStep2.classList.remove('hidden');
            } else {
                alert(data.detail || 'Error requesting reset code');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to server');
        } finally {
            fpRequestBtn.disabled = false;
            fpRequestBtn.innerText = 'Send Confirmation Code';
        }
    });
}

if (fpValidateBtn) {
    fpValidateBtn.addEventListener('click', async () => {
        const username = fpUsername.value.trim();
        const code = fpCode.value.trim();
        if (!code) return alert('Please enter the confirmation code');
        try {
            fpValidateBtn.disabled = true;
            fpValidateBtn.innerText = 'Validating...';
            const res = await fetch('/api/validate-reset-code', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, code})
            });
            const data = await res.json();
            if (res.ok) {
                fpCode.disabled = true;
                fpValidateBtn.classList.add('hidden');
                fpStep3.classList.remove('hidden');
            } else {
                alert(data.detail || 'Invalid confirmation code');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to server');
        } finally {
            fpValidateBtn.disabled = false;
            fpValidateBtn.innerText = 'Validate Code';
        }
    });
}

if (fpResetBtn) {
    fpResetBtn.addEventListener('click', async () => {
        const username = fpUsername.value.trim();
        const code = fpCode.value.trim();
        const new_password = fpNewPassword.value.trim();
        if (!new_password) return alert('Please enter a new password');
        try {
            fpResetBtn.disabled = true;
            fpResetBtn.innerText = 'Resetting...';
            const res = await fetch('/api/reset-password', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username, code, new_password})
            });
            const data = await res.json();
            if (res.ok) {
                alert('Password reset successfully! You can now log in.');
                fpModal.classList.add('hidden');
            } else {
                alert(data.detail || 'Error resetting password');
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to server');
        } finally {
            fpResetBtn.disabled = false;
            fpResetBtn.innerText = 'Reset Password';
        }
    });
}
