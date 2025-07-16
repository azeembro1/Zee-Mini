/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";

// --- TYPE DEFINITIONS ---
type AttendanceStatus = 'present' | 'absent';

interface AttendanceRecord { [date: string]: AttendanceStatus; }
interface AttendanceHistory { [studentId: string]: AttendanceRecord; }
interface Student { id: string; rollNo: number; name: string; phone: string; photo: string; }
interface Students { [classId: string]: Student[]; }
interface Class { id: string; name: string; teacherName?: string; teacherPhone?: string; }
interface AcademicYearData { classes: Class[]; students: Students; attendanceHistory: AttendanceHistory; }

interface AppSettings {
    collegeName: string;
    logo: string;
    // Admin specific settings for donations
    adminName?: string;
    easypaisaNumber?: string;
    easypaisaName?: string;
    jazzcashNumber?: string;
    jazzcashName?: string;
}

interface AppData {
    settings: AppSettings;
    academicYears: { [year: string]: AcademicYearData; };
}

interface AppState {
    currentPage: string;
    currentYear: string | null;
    currentClassId: string | null;
    currentStudentId: string | null;
}

// --- DOM ELEMENT TYPES ---
interface DOMElements {
    [key: string]: HTMLElement | HTMLFormElement | HTMLInputElement | HTMLSelectElement | NodeListOf<HTMLElement>;
    pages: NodeListOf<HTMLElement>;
    backBtns: NodeListOf<HTMLElement>;
    userLogoImages: NodeListOf<HTMLImageElement>;
    collegeNameHeaders: NodeListOf<HTMLElement>;
}

// --- STATE & DB MANAGEMENT ---
const state: AppState = { currentPage: 'page-start', currentYear: null, currentClassId: null, currentStudentId: null, };
let appData: AppData | null = null;
let ai: GoogleGenAI;
const dom = {} as DOMElements;
let modalConfirmCallback: () => void = () => {};

const DEFAULT_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%230d2c54' d='M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5-10-5-10 5z'/%3E%3C/svg%3E";
const DEFAULT_PHOTO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23CCC'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

// --- DATABASE FUNCTIONS ---
function saveAppData() {
    if (appData) {
        localStorage.setItem('zeeMiniAppData', JSON.stringify(appData));
    }
}

function loadAppData() {
    const dbString = localStorage.getItem('zeeMiniAppData');
    if (dbString) {
        try {
            appData = JSON.parse(dbString);
            return true;
        } catch (e) {
            console.error("Failed to parse app data, resetting.", e);
            localStorage.removeItem('zeeMiniAppData');
            return false;
        }
    }
    return false;
}

// --- DOM & INITIALIZATION ---
function cacheDOMElements() {
    document.querySelectorAll<HTMLElement>('[id]').forEach(el => {
        const id = el.id.replace(/-([a-z])/g, g => g[1].toUpperCase());
        dom[id] = el;
    });
    dom.pages = document.querySelectorAll<HTMLElement>('.page');
    dom.backBtns = document.querySelectorAll<HTMLElement>('.btn-back');
    dom.userLogoImages = document.querySelectorAll<HTMLImageElement>('[id^="user-logo-"]');
    dom.collegeNameHeaders = document.querySelectorAll<HTMLElement>('[id^="college-name-"]');
}

/**
 * Attaches all event listeners for the main application.
 * This function is "bulletproof" - it checks if an element exists before
 * adding a listener, preventing the entire script from crashing if an
 * element is not found in the DOM.
 */
function attachMainEventListeners() {
    // Page navigation
    if (dom.backBtns) {
        dom.backBtns.forEach(btn => {
            if (btn) btn.addEventListener('click', (e) => showPage((e.currentTarget as HTMLElement).dataset.target || 'page-start'));
        });
    }
    
    if (dom.yearProceedBtn) (dom.yearProceedBtn as HTMLElement).addEventListener('click', handleYearSelection);
    if (dom.addYearBtn) (dom.addYearBtn as HTMLElement).addEventListener('click', handleAddYear);
    if (dom.classGrid) (dom.classGrid as HTMLElement).addEventListener('click', handleClassGridClick);
    if (dom.studentTableBody) (dom.studentTableBody as HTMLElement).addEventListener('click', handleStudentTableClick);
    
    // Main actions
    if (dom.addStudentBtn) (dom.addStudentBtn as HTMLElement).addEventListener('click', handleAddStudent);
    if (dom.viewClassReportBtn) (dom.viewClassReportBtn as HTMLElement).addEventListener('click', handleViewClassReport);
    if (dom.generateAiSummaryBtn) (dom.generateAiSummaryBtn as HTMLElement).addEventListener('click', handleGenerateAISummary);
    
    // Main Menu & Admin
    if (dom.mainMenuBtn) (dom.mainMenuBtn as HTMLElement).addEventListener('click', () => showMainMenuModal('tab-about'));
    if (dom.userSettingsBtn) (dom.userSettingsBtn as HTMLElement).addEventListener('click', () => showMainMenuModal('tab-settings'));
    if (dom.adminAccessTrigger) (dom.adminAccessTrigger as HTMLElement).addEventListener('click', handleAdminAccess);
    if (dom.saveAdminSettingsBtn) (dom.saveAdminSettingsBtn as HTMLElement).addEventListener('click', handleSaveAdminSettings);
    if (dom.cancelAdminSettingsBtn) (dom.cancelAdminSettingsBtn as HTMLElement).addEventListener('click', () => { if(dom.adminSettingsModal) (dom.adminSettingsModal as HTMLElement).style.display = 'none'; });
    
    // Main Menu Event Listeners (Tabs, Save, Close)
    if (dom.mainMenuModal) {
        (dom.mainMenuModal as HTMLElement).addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('modal-tab-btn')) {
                handleMenuTabClick(target);
            }
            if (target.id === 'main-menu-close-btn') {
                (dom.mainMenuModal as HTMLElement).style.display = 'none';
            }
            if (target.id === 'main-menu-save-btn') {
                handleSaveUserSettings();
            }
        });
    }
    if (dom.userLogoUpload) (dom.userLogoUpload as HTMLInputElement).addEventListener('change', handleLogoPreview);

    // Data Management
    if (dom.exportDataBtn) (dom.exportDataBtn as HTMLElement).addEventListener('click', handleExportData);
    if (dom.importDataBtn) (dom.importDataBtn as HTMLElement).addEventListener('click', handleImportData);

    // Generic Modal
    if (dom.modalCancelBtn) (dom.modalCancelBtn as HTMLElement).addEventListener('click', hideModal);
    if (dom.modalBackdrop) (dom.modalBackdrop as HTMLElement).addEventListener('click', (e) => { if (e.target === dom.modalBackdrop) hideModal(); });
    
    // Set today's date for attendance
    if (dom.attendanceDate) (dom.attendanceDate as HTMLInputElement).valueAsDate = new Date();
}


function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            // Use a root-relative path to be more robust and prevent origin errors.
            navigator.serviceWorker.register('/service-worker.js').then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, err => {
                console.log('ServiceWorker registration failed: ', err);
            });
        });
    }
}

function handleInitialSetup() {
    const setupInput = dom.setupInstituteName as HTMLInputElement;
    if (!setupInput) return; // Defensive check
    
    const collegeName = setupInput.value.trim();
    if (!collegeName) {
        alert("Please enter your institute's name.");
        setupInput.focus();
        return;
    }

    // Create the default data structure.
    const defaultAppData: AppData = {
        settings: {
            collegeName: collegeName,
            logo: DEFAULT_LOGO,
            adminName: 'AZEEM BRO',
            easypaisaName: 'Muhammad Naveed',
            easypaisaNumber: '03000900805',
            jazzcashName: 'Muhammad Naveed',
            jazzcashNumber: '03000900805'
        },
        academicYears: {
            '2024-2025': { classes: [], students: {}, attendanceHistory: {} }
        }
    };
    
    appData = defaultAppData;
    saveAppData();

    // The MOST ROBUST WAY to transition state: save data and reload the page.
    // This forces the app to re-initialize in its "configured" state cleanly,
    // solving all race conditions and initialization bugs.
    location.reload();
}


function initApp() {
    cacheDOMElements(); // Cache all elements immediately.

    if (loadAppData()) {
        // App is already configured. Hide setup, show main app.
        if (dom.pageInitialSetup) (dom.pageInitialSetup as HTMLElement).classList.remove('active');
        
        // Attach all event listeners for the main app.
        attachMainEventListeners();
        // Register the service worker for offline functionality.
        registerServiceWorker();
        // Go to the main screen.
        showPage('page-year-selection'); 
    } else {
        // App is not configured. Show the setup page (it's active by default in HTML)
        // and attach ONLY the setup handler.
        if (dom.initialSetupBtn) {
            (dom.initialSetupBtn as HTMLElement).addEventListener('click', handleInitialSetup);
        } else {
            console.error("CRITICAL: Initial setup button not found!");
        }
    }
}

// --- PAGE & UI RENDER ---
function showPage(pageId: string) {
    state.currentPage = pageId;
    if(dom.pages) dom.pages.forEach(page => page.classList.toggle('active', page.id === pageId));

    if (pageId.startsWith('page-')) {
        document.body.scrollTop = document.documentElement.scrollTop = 0;
    }

    // Page-specific render logic
    if (appData) {
        updateHeaders();
        if (pageId === 'page-year-selection') renderYearSelection();
        if (pageId === 'page-class-selection') renderClassSelection();
        if (pageId === 'page-class-details') renderStudentList(state.currentClassId || '');
        if (pageId === 'page-class-report') renderClassReport(state.currentClassId || '');
    }
}

function updateHeaders() {
    if (!appData) return;
    const { collegeName, logo } = appData.settings;
    if(dom.collegeNameHeaders) dom.collegeNameHeaders.forEach(h => h.textContent = collegeName);
    if(dom.userLogoImages) dom.userLogoImages.forEach(img => img.src = logo || DEFAULT_LOGO);
}

// --- RENDER FUNCTIONS ---
function renderYearSelection() {
    if (!appData) return;
    const selector = dom.yearSelector as HTMLSelectElement;
    if (!selector) return;

    selector.innerHTML = '';
    const years = Object.keys(appData.academicYears).sort().reverse();
    if (years.length === 0) {
        const defaultYear = '2024-2025';
        appData.academicYears[defaultYear] = { classes: [], students: {}, attendanceHistory: {} };
        saveAppData();
        years.push(defaultYear);
    }
    years.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        selector.appendChild(option);
    });
}

function handleYearSelection() {
    const selector = dom.yearSelector as HTMLSelectElement;
    if (selector) {
        state.currentYear = selector.value;
        showPage('page-class-selection');
    }
}

function getCurrentYearData(): AcademicYearData | null {
    if (!appData || !state.currentYear) return null;
    return appData.academicYears[state.currentYear];
}

function renderClassSelection() {
    const yearData = getCurrentYearData();
    if (!yearData) { showPage('page-year-selection'); return; }

    const yearDisplays = document.querySelectorAll('.year-display') as NodeListOf<HTMLElement>;
    if (yearDisplays) yearDisplays.forEach(el => el.textContent = state.currentYear);
    
    const grid = dom.classGrid as HTMLElement;
    if (!grid) return;
    
    grid.innerHTML = '';
    yearData.classes.forEach(cls => {
        const card = document.createElement('div');
        card.className = 'class-card';
        card.dataset.classId = cls.id;
        card.innerHTML = `<div class="class-card-icon"></div><div class="class-card-name">${cls.name}</div>`;
        grid.appendChild(card);
    });
    const addCard = document.createElement('div');
    addCard.className = 'add-new-card';
    addCard.dataset.action = 'add-class';
    addCard.innerHTML = 'Add New Class';
    grid.appendChild(addCard);
}

function renderStudentList(classId: string) {
    if (!classId) { showPage('page-class-selection'); return; }
    const yearData = getCurrentYearData();
    if (!yearData) return;

    state.currentClassId = classId;
    const students = yearData.students[classId] || [];
    const cls = yearData.classes.find(c => c.id === classId);
    if (cls && dom.classNameHeader) (dom.classNameHeader as HTMLElement).textContent = cls.name;

    const tbody = dom.studentTableBody as HTMLElement;
    if (!tbody) return;

    tbody.innerHTML = '';
    if (students.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-list-message">No students found. Click 'Add New Student' to begin.</td></tr>`;
        return;
    }

    students.sort((a,b) => a.rollNo - b.rollNo).forEach(student => {
        const attendance = calculateAttendancePercentage(student.id);
        const row = document.createElement('tr');
        row.dataset.studentId = student.id;
        row.innerHTML = `
            <td><img src="${student.photo || DEFAULT_PHOTO}" alt="Photo" class="student-photo-thumb"></td>
            <td class="student-details-cell">
                <span class="student-name">${student.name}</span>
                <span class="student-roll">Roll No: ${student.rollNo}</span>
            </td>
            <td>${student.phone}</td>
            <td><span class="attendance-percent-badge">${attendance}%</span></td>
            <td class="actions-cell">
                <div class="action-group">
                    <div class="status-buttons">
                        <button class="status-btn present" data-action="mark-attendance" data-status="present" title="Mark Present">P</button>
                        <button class="status-btn absent" data-action="mark-attendance" data-status="absent" title="Mark Absent">A</button>
                    </div>
                    <button class="status-btn info" data-action="view-report" title="View Report">Report</button>
                    <button class="action-btn edit" data-action="edit-student" title="Edit">&#9998;</button>
                    <button class="action-btn delete" data-action="delete-student" title="Delete">&#128465;</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function calculateAttendancePercentage(studentId: string): number {
    const yearData = getCurrentYearData();
    if (!yearData) return 0;
    const history = yearData.attendanceHistory[studentId] || {};
    const days = Object.values(history);
    if (days.length === 0) return 100; // No records yet
    const presentCount = days.filter(d => d === 'present').length;
    return Math.round((presentCount / days.length) * 100);
}

// --- EVENT HANDLers ---
function handleClassGridClick(e: MouseEvent) {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.class-card, .add-new-card');
    if (!card) return;

    if (card.dataset.action === 'add-class') { handleAddClass(); } 
    else if (card.dataset.classId) {
        renderStudentList(card.dataset.classId);
        showPage('page-class-details');
    }
}

function handleStudentTableClick(e: MouseEvent) {
    const button = (e.target as HTMLElement).closest('button');
    if (!button) return;

    const studentId = (button.closest('tr') as HTMLTableRowElement)?.dataset.studentId;
    const { action, status } = button.dataset;
    if (!studentId) return;

    switch (action) {
        case 'mark-attendance': handleMarkAttendance(studentId, status as AttendanceStatus); break;
        case 'view-report': renderStudentReport(studentId); break;
        case 'edit-student': handleEditStudent(studentId); break;
        case 'delete-student': handleDeleteStudent(studentId); break;
    }
}

// --- CRUD & ACTIONS ---
function handleAddYear() {
    showModal('Add New Academic Year', `...`, () => {
        const input = document.getElementById('new-year-name') as HTMLInputElement;
        const newYear = input.value.trim();
        if (newYear && appData) {
            if (appData.academicYears[newYear]) {
                alert('This academic year already exists.');
                return;
            }
            appData.academicYears[newYear] = { classes: [], students: {}, attendanceHistory: {} };
            saveAppData();
            renderYearSelection();
            hideModal();
        }
    });
    if (dom.modalBody) (dom.modalBody as HTMLElement).innerHTML = `
        <div class="modal-form">
            <label for="new-year-name">Academic Year</label>
            <input type="text" id="new-year-name" class="input-field" placeholder="e.g., 2025-2026" required>
        </div>`;
}


function handleAddClass() {
    showModal('Add New Class', `...`, () => {
        const yearData = getCurrentYearData();
        const nameInput = document.getElementById('new-class-name') as HTMLInputElement;
        const teacherNameInput = document.getElementById('new-teacher-name') as HTMLInputElement;
        const teacherPhoneInput = document.getElementById('new-teacher-phone') as HTMLInputElement;
        
        const name = nameInput.value.trim();
        const teacherName = teacherNameInput.value.trim();
        const teacherPhone = teacherPhoneInput.value.trim();

        if (name && yearData) {
            const newClass: Class = { 
                id: `c${Date.now()}`, 
                name,
                teacherName,
                teacherPhone
            };
            yearData.classes.push(newClass);
            yearData.students[newClass.id] = [];
            saveAppData();
            renderClassSelection();
            hideModal();
        }
    });
    if (dom.modalBody) (dom.modalBody as HTMLElement).innerHTML = `
        <div class="modal-form">
            <label for="new-class-name">Class Name</label>
            <input type="text" id="new-class-name" class="input-field" placeholder="e.g., B.Sc Physics" required>
            <label for="new-teacher-name">Teacher's Name</label>
            <input type="text" id="new-teacher-name" class="input-field" placeholder="e.g., Mr. Ahmed Khan">
            <label for="new-teacher-phone">Teacher's Phone</label>
            <input type="tel" id="new-teacher-phone" class="input-field" placeholder="e.g., 0300-1234567">
        </div>`;
}

async function handleAddStudent() {
    showModal('Add New Student', `...`, async () => {
        const yearData = getCurrentYearData();
        const classId = state.currentClassId;
        if (!yearData || !classId) return;

        const name = (document.getElementById('new-student-name') as HTMLInputElement).value.trim();
        const rollNo = (document.getElementById('new-student-roll') as HTMLInputElement).value;
        const phone = (document.getElementById('new-student-phone') as HTMLInputElement).value.trim();
        const photoFile = (document.getElementById('new-student-photo') as HTMLInputElement).files?.[0];
        
        if (name && rollNo) {
            const photo = photoFile ? await fileToBase64(photoFile) : DEFAULT_PHOTO;
            const newStudent: Student = { id: `s${Date.now()}`, name, rollNo: parseInt(rollNo, 10), phone, photo };
            if (!yearData.students[classId]) yearData.students[classId] = [];
            yearData.students[classId].push(newStudent);
            saveAppData();
            renderStudentList(classId);
            hideModal();
        }
    });
     if (dom.modalBody) (dom.modalBody as HTMLElement).innerHTML = `
        <form id="add-student-form" class="modal-form">
            <label for="new-student-name">Full Name</label> <input type="text" id="new-student-name" class="input-field" required>
            <label for="new-student-roll">Roll No</label> <input type="number" id="new-student-roll" class="input-field" required>
            <label for="new-student-phone">Phone</label> <input type="tel" id="new-student-phone" class="input-field">
            <label for="new-student-photo">Photo</label> <input type="file" id="new-student-photo" class="input-field" accept="image/*">
        </form>`;
}

async function handleEditStudent(studentId: string) {
    const yearData = getCurrentYearData();
    const classId = state.currentClassId;
    if (!yearData || !classId) return;
    const student = yearData.students[classId].find(s => s.id === studentId);
    if (!student) return;

    showModal('Edit Student', `...`, async () => {
        const photoFile = (document.getElementById('edit-student-photo') as HTMLInputElement).files?.[0];
        student.name = (document.getElementById('edit-student-name') as HTMLInputElement).value.trim();
        student.rollNo = parseInt((document.getElementById('edit-student-roll') as HTMLInputElement).value, 10);
        student.phone = (document.getElementById('edit-student-phone') as HTMLInputElement).value.trim();
        if (photoFile) student.photo = await fileToBase64(photoFile);
        saveAppData();
        renderStudentList(classId);
        hideModal();
    });
    if (dom.modalBody) (dom.modalBody as HTMLElement).innerHTML = `
        <form id="edit-student-form" class="modal-form">
            <label for="edit-student-name">Full Name</label> <input type="text" id="edit-student-name" class="input-field" value="${student.name}" required>
            <label for="edit-student-roll">Roll No</label> <input type="number" id="edit-student-roll" class="input-field" value="${student.rollNo}" required>
            <label for="edit-student-phone">Phone</label> <input type="tel" id="edit-student-phone" class="input-field" value="${student.phone}">
            <label for="edit-student-photo">New Photo (optional)</label> <input type="file" id="edit-student-photo" class="input-field" accept="image/*">
        </form>`;
}

function handleDeleteStudent(studentId: string) {
    showModal('Delete Student', `<p>Are you sure you want to delete this student and all their records? This cannot be undone.</p>`, () => {
        const yearData = getCurrentYearData();
        const classId = state.currentClassId;
        if (yearData && classId) {
            yearData.students[classId] = yearData.students[classId].filter(s => s.id !== studentId);
            delete yearData.attendanceHistory[studentId];
            saveAppData();
            renderStudentList(classId);
            hideModal();
        }
    });
}

function handleMarkAttendance(studentId: string, status: AttendanceStatus) {
    const yearData = getCurrentYearData();
    const date = (dom.attendanceDate as HTMLInputElement).value;
    if (!yearData || !date) { alert("Please select a valid date."); return; }
    
    if (!yearData.attendanceHistory[studentId]) yearData.attendanceHistory[studentId] = {};
    yearData.attendanceHistory[studentId][date] = status;
    saveAppData();
    
    if (dom.studentTableBody) {
        const row = (dom.studentTableBody as HTMLElement).querySelector(`tr[data-student-id="${studentId}"]`);
        if (row) {
            const badge = row.querySelector('.attendance-percent-badge') as HTMLElement;
            if (badge) badge.textContent = `${calculateAttendancePercentage(studentId)}%`;
            
            const feedbackClass = status === 'present' ? 'feedback-present' : 'feedback-absent';
            row.classList.add(feedbackClass);
            setTimeout(() => row.classList.remove(feedbackClass), 800);
        }
    }
}

// --- MAIN MENU, DONATION & ADMIN ---
function showMainMenuModal(initialTab: 'tab-about' | 'tab-settings') {
    if (!appData || !dom.mainMenuModal) return;
    const settings = appData.settings;
    
    // Populate Settings Tab
    if (dom.userCollegeName) (dom.userCollegeName as HTMLInputElement).value = settings.collegeName;
    if (dom.userLogoPreview) {
        (dom.userLogoPreview as HTMLImageElement).src = settings.logo || DEFAULT_LOGO;
        (dom.userLogoPreview as HTMLImageElement).style.display = 'block';
    }

    // Populate About & Donate Tab
    if (dom.donateEasypaisaName) (dom.donateEasypaisaName as HTMLElement).textContent = settings.easypaisaName || 'N/A';
    if (dom.donateEasypaisaNumber) (dom.donateEasypaisaNumber as HTMLElement).textContent = settings.easypaisaNumber || 'N/A';
    if (dom.donateJazzcashName) (dom.donateJazzcashName as HTMLElement).textContent = settings.jazzcashName || 'N/A';
    if (dom.donateJazzcashNumber) (dom.donateJazzcashNumber as HTMLElement).textContent = settings.jazzcashNumber || 'N/A';
    
    // Set the initial active tab
    const aboutTabBtn = (dom.mainMenuModal as HTMLElement).querySelector('[data-tab="tab-about"]');
    const settingsTabBtn = (dom.mainMenuModal as HTMLElement).querySelector('[data-tab="tab-settings"]');
    const aboutTabContent = document.getElementById('tab-about');
    const settingsTabContent = document.getElementById('tab-settings');

    if (initialTab === 'tab-settings' && settingsTabBtn && aboutTabBtn && settingsTabContent && aboutTabContent) {
        settingsTabBtn.classList.add('active');
        aboutTabBtn.classList.remove('active');
        settingsTabContent.classList.add('active');
        aboutTabContent.classList.remove('active');
    } else if (aboutTabBtn && settingsTabBtn && aboutTabContent && settingsTabContent) {
        aboutTabBtn.classList.add('active');
        settingsTabBtn.classList.remove('active');
        aboutTabContent.classList.add('active');
        settingsTabContent.classList.remove('active');
    }

    (dom.mainMenuModal as HTMLElement).style.display = 'flex';
}


function handleMenuTabClick(clickedTab: HTMLElement) {
    const targetTabId = clickedTab.dataset.tab;
    if (!targetTabId || !dom.mainMenuModal) return;

    (dom.mainMenuModal as HTMLElement).querySelectorAll('.modal-tab-btn').forEach(btn => btn.classList.remove('active'));
    clickedTab.classList.add('active');

    (dom.mainMenuModal as HTMLElement).querySelectorAll('.modal-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === targetTabId);
    });
}

function handleAdminAccess() {
    const pass = prompt("Enter admin password:");
    if (pass === 'admin2024') {
        showAdminSettingsModal();
    } else if (pass !== null) {
        alert("Incorrect password.");
    }
}

function showAdminSettingsModal() {
    if (!appData || !dom.adminSettingsModal) return;
    const settings = appData.settings;
    if(dom.adminInfoName) (dom.adminInfoName as HTMLInputElement).value = settings.adminName || '';
    if(dom.adminInfoEasypaisaName) (dom.adminInfoEasypaisaName as HTMLInputElement).value = settings.easypaisaName || '';
    if(dom.adminInfoEasypaisa) (dom.adminInfoEasypaisa as HTMLInputElement).value = settings.easypaisaNumber || '';
    if(dom.adminInfoJazzcashName) (dom.adminInfoJazzcashName as HTMLInputElement).value = settings.jazzcashName || '';
    if(dom.adminInfoJazzcash) (dom.adminInfoJazzcash as HTMLInputElement).value = settings.jazzcashNumber || '';
    (dom.adminSettingsModal as HTMLElement).style.display = 'flex';
}

function handleSaveAdminSettings() {
    if (!appData) return;
    if(dom.adminInfoName) appData.settings.adminName = (dom.adminInfoName as HTMLInputElement).value.trim();
    if(dom.adminInfoEasypaisaName) appData.settings.easypaisaName = (dom.adminInfoEasypaisaName as HTMLInputElement).value.trim();
    if(dom.adminInfoEasypaisa) appData.settings.easypaisaNumber = (dom.adminInfoEasypaisa as HTMLInputElement).value.trim();
    if(dom.adminInfoJazzcashName) appData.settings.jazzcashName = (dom.adminInfoJazzcashName as HTMLInputElement).value.trim();
    if(dom.adminInfoJazzcash) appData.settings.jazzcashNumber = (dom.adminInfoJazzcash as HTMLInputElement).value.trim();
    saveAppData();
    alert("Donation info saved!");
    if(dom.adminSettingsModal) (dom.adminSettingsModal as HTMLElement).style.display = 'none';
}


// --- USER SETTINGS (within Main Menu) ---
async function handleSaveUserSettings() {
    if (!appData || !dom.userCollegeName || !dom.userLogoUpload) return;
    const newName = (dom.userCollegeName as HTMLInputElement).value.trim();
    const logoFile = (dom.userLogoUpload as HTMLInputElement).files?.[0];
    if (newName) appData.settings.collegeName = newName;
    if (logoFile) appData.settings.logo = await fileToBase64(logoFile);

    saveAppData();
    updateHeaders();
    if(dom.mainMenuModal) (dom.mainMenuModal as HTMLElement).style.display = 'none';
}
function handleLogoPreview(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file && dom.userLogoPreview) {
        const reader = new FileReader();
        reader.onload = (event) => {
            if (dom.userLogoPreview) {
                (dom.userLogoPreview as HTMLImageElement).src = event.target?.result as string;
                (dom.userLogoPreview as HTMLImageElement).style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
    }
}


// --- UTILITY & API FUNCTIONS ---
function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
}

function renderStudentReport(studentId: string) {
    const yearData = getCurrentYearData();
    const classId = state.currentClassId;
    if (!yearData || !classId) return;

    const student = yearData.students[classId]?.find(s => s.id === studentId);
    if (!student) return;

    state.currentStudentId = studentId;

    if(dom.reportStudentName) (dom.reportStudentName as HTMLElement).textContent = student.name;
    if(dom.reportStudentPhone) (dom.reportStudentPhone as HTMLElement).textContent = student.phone;
    if(dom.reportStudentPhoto) (dom.reportStudentPhoto as HTMLImageElement).src = student.photo || DEFAULT_PHOTO;
    if(dom.studentAttendancePercent) (dom.studentAttendancePercent as HTMLElement).textContent = `${calculateAttendancePercentage(studentId)}%`;

    const classInfo = yearData.classes.find(c => c.id === classId);
    const teacherInfoDiv = dom.reportTeacherInfo as HTMLElement;
    if (teacherInfoDiv) {
        if (classInfo && (classInfo.teacherName || classInfo.teacherPhone)) {
            teacherInfoDiv.innerHTML = `
                <h4>Teacher Contact</h4>
                <p class="teacher-name">${classInfo.teacherName || 'N/A'}</p>
                <p class="teacher-phone">${classInfo.teacherPhone || 'N/A'}</p>
            `;
            teacherInfoDiv.style.display = 'flex';
        } else {
            teacherInfoDiv.style.display = 'none';
        }
    }

    const chartContainer = (dom.attendanceChart as HTMLElement);
    if(chartContainer) {
        chartContainer.innerHTML = '';
        const attendanceHistory = yearData.attendanceHistory[studentId] || {};
        
        const monthlyData: { [month: string]: AttendanceRecord } = {};
        for (const dateStr in attendanceHistory) {
            const month = dateStr.substring(0, 7); // YYYY-MM
            if (!monthlyData[month]) monthlyData[month] = {};
            monthlyData[month][dateStr] = attendanceHistory[dateStr];
        }

        const sortedMonths = Object.keys(monthlyData).sort().reverse();
        if (sortedMonths.length === 0) {
            chartContainer.innerHTML = '<p class="empty-list-message">No attendance records found for this student.</p>';
        }

        sortedMonths.forEach(monthStr => {
            const monthContainer = document.createElement('div');
            monthContainer.className = 'month-grid';
            
            const date = new Date(`${monthStr}-02`);
            const monthName = date.toLocaleString('default', { month: 'long', year: 'numeric' });

            monthContainer.innerHTML = `<h3>${monthName}</h3>`;
            const calendarGrid = document.createElement('div');
            calendarGrid.className = 'calendar';
            
            ['S','M','T','W','T','F','S'].forEach(day => {
                const dayHeader = document.createElement('div');
                dayHeader.className = 'day-header';
                dayHeader.textContent = day;
                calendarGrid.appendChild(dayHeader);
            });

            const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
            for (let i = 0; i < firstDay; i++) { calendarGrid.appendChild(document.createElement('div')); }

            const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
            for (let day = 1; day <= daysInMonth; day++) {
                const dayCell = document.createElement('div');
                dayCell.className = 'day-cell';
                dayCell.textContent = day.toString();
                
                const fullDateStr = `${monthStr}-${day.toString().padStart(2, '0')}`;
                if (monthlyData[monthStr][fullDateStr]) {
                    dayCell.classList.add(monthlyData[monthStr][fullDateStr]);
                }
                calendarGrid.appendChild(dayCell);
            }

            monthContainer.appendChild(calendarGrid);
            chartContainer.appendChild(monthContainer);
        });
    }

    if (dom.aiSummaryContainer) (dom.aiSummaryContainer as HTMLElement).style.display = 'none';
    showPage('page-student-report');
}

function handleViewClassReport() {
    if (!state.currentClassId) return;
    showPage('page-class-report');
}

function renderClassReport(classId: string) {
    if (!classId) { showPage('page-class-details'); return; }
    const yearData = getCurrentYearData();
    if (!yearData) return;

    const classInfo = yearData.classes.find(c => c.id === classId);
    if (!classInfo) return;

    if(dom.classReportNameHeader) (dom.classReportNameHeader as HTMLElement).textContent = classInfo.name;

    const students = yearData.students[classId] || [];
    const studentListContainer = dom.classReportStudentList as HTMLElement;
    
    const teacherInfoDiv = dom.classReportTeacherInfo as HTMLElement;
    if(teacherInfoDiv) {
        if (classInfo.teacherName || classInfo.teacherPhone) {
            teacherInfoDiv.innerHTML = `
                <h4>Teacher In-charge</h4>
                <p class="teacher-name">${classInfo.teacherName || 'N/A'}</p>
                <p class="teacher-phone">${classInfo.teacherPhone || 'N/A'}</p>
            `;
        } else {
            teacherInfoDiv.innerHTML = '<h4>No Teacher Info Available</h4>';
        }
    }

    if (studentListContainer && students.length === 0) {
        if(dom.classReportPercentage) (dom.classReportPercentage as HTMLElement).textContent = 'N/A';
        studentListContainer.innerHTML = '<p class="empty-list-message">No students in this class to report.</p>';
        return;
    }

    const studentPerformances = students.map(s => ({
        ...s,
        attendance: calculateAttendancePercentage(s.id)
    }));
    studentPerformances.sort((a, b) => b.attendance - a.attendance);

    if (students.length > 0) {
        const totalPercentage = studentPerformances.reduce((acc, s) => acc + s.attendance, 0);
        const averagePercentage = Math.round(totalPercentage / students.length);
        if(dom.classReportPercentage) (dom.classReportPercentage as HTMLElement).textContent = `${averagePercentage}%`;
    }
    
    if(studentListContainer) {
        studentListContainer.innerHTML = '';
        studentPerformances.forEach((student, index) => {
            const studentRow = document.createElement('div');
            studentRow.className = 'ranked-student-item';
            studentRow.innerHTML = `
                <div class="rank-badge">${index + 1}</div>
                <img src="${student.photo || DEFAULT_PHOTO}" class="student-photo-thumb">
                <div class="ranked-student-details">
                    <span class="student-name">${student.name}</span>
                    <span class="student-roll">Roll No: ${student.rollNo}</span>
                </div>
                <div class="ranked-student-percentage">${student.attendance}%</div>
            `;
            studentListContainer.appendChild(studentRow);
        });
    }
}


async function handleGenerateAISummary() {
    const studentId = state.currentStudentId;
    const yearData = getCurrentYearData();
    if (!studentId || !yearData) return;

    const attendanceHistory = yearData.attendanceHistory[studentId] || {};
    const student = yearData.students[state.currentClassId || '']?.find(s => s.id === studentId);
    if (!student) return;

    const presentCount = Object.values(attendanceHistory).filter(s => s === 'present').length;
    const absentCount = Object.values(attendanceHistory).filter(s => s === 'absent').length;
    const totalDays = presentCount + absentCount;
    
    const summaryContainer = dom.aiSummaryContainer as HTMLElement;
    const summaryText = dom.aiSummaryText as HTMLElement;
    const loader = dom.aiSummaryLoader as HTMLElement;

    if (!summaryContainer || !summaryText || !loader) return;

    if (totalDays === 0) {
        summaryText.textContent = "No attendance data available to generate a summary.";
        summaryContainer.style.display = 'block';
        return;
    }

    const prompt = `
        Analyze the following student attendance data and provide a brief, professional summary (2-3 sentences).
        Student Name: ${student.name}
        Total Days Recorded: ${totalDays}
        Days Present: ${presentCount}
        Days Absent: ${absentCount}
        
        Focus on consistency, patterns (if any are obvious), and overall attendance record. Be encouraging but realistic.
    `;

    summaryText.textContent = '';
    loader.style.display = 'block';
    summaryContainer.style.display = 'block';

    try {
        if (!ai) ai = new GoogleGenAI({apiKey: process.env.API_KEY || ''});
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [{ text: prompt }] }],
        });
        summaryText.textContent = response.text;
    } catch (error) {
        console.error("AI Summary Error:", error);
        summaryText.textContent = "Could not generate summary at this time. Please check your API key and connection.";
    } finally {
        loader.style.display = 'none';
    }
}


function showModal(title: string, bodyHtml: string, onConfirm: () => void) {
    if (!dom.modalBackdrop || !dom.modalTitle || !dom.modalBody || !dom.modalConfirmBtn) return;
    (dom.modalTitle as HTMLElement).textContent = title;
    (dom.modalBody as HTMLElement).innerHTML = bodyHtml;
    modalConfirmCallback = onConfirm;
    (dom.modalConfirmBtn as HTMLElement).onclick = () => {
        const form = (dom.modalBody as HTMLElement).querySelector('form');
        if (form && !form.checkValidity()) { form.reportValidity(); return; }
        modalConfirmCallback();
    };
    (dom.modalBackdrop as HTMLElement).style.display = 'flex';
}

function hideModal() {
    if (!dom.modalBackdrop || !dom.modalBody) return;
    (dom.modalBackdrop as HTMLElement).style.display = 'none';
    (dom.modalBody as HTMLElement).innerHTML = '';
    modalConfirmCallback = () => {};
    if(dom.modalConfirmBtn) (dom.modalConfirmBtn as HTMLElement).textContent = 'Confirm';
    if(dom.modalCancelBtn) (dom.modalCancelBtn as HTMLElement).style.display = 'inline-flex';
}

// --- DATA MANAGEMENT ---
function handleExportData() {
    if (!appData) {
        alert("No data to export.");
        return;
    }
    try {
        // Create a deep copy to avoid modifying the live appData object
        const exportData = JSON.parse(JSON.stringify(appData));

        // **IMPORTANT SECURITY FIX**: Remove sensitive admin info from the export file.
        if (exportData.settings) {
            delete exportData.settings.adminName;
            delete exportData.settings.easypaisaName;
            delete exportData.settings.easypaisaNumber;
            delete exportData.settings.jazzcashName;
            delete exportData.settings.jazzcashNumber;
        }

        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `zee-mini-backup-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert("Data export successful! Your backup file has been downloaded.");
    } catch (error) {
        console.error("Failed to export data:", error);
        alert("An error occurred while exporting data.");
    }
}

function handleImportData() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.onchange = e => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = event => {
            try {
                const importedDataString = event.target?.result as string;
                const importedData = JSON.parse(importedDataString);
                // Basic validation
                if (importedData && importedData.settings && importedData.academicYears) {
                     showModal(
                        'Confirm Import',
                        `<p>Are you sure you want to replace all student and class data with the data from <strong>${file.name}</strong>?</p><p><strong>Admin and donation info will NOT be changed.</strong> This action cannot be undone.</p>`,
                        () => {
                            // **IMPORTANT SECURITY FIX**: Preserve existing admin info
                            const currentAdminSettings = appData ? {
                                adminName: appData.settings.adminName,
                                easypaisaName: appData.settings.easypaisaName,
                                easypaisaNumber: appData.settings.easypaisaNumber,
                                jazzcashName: appData.settings.jazzcashName,
                                jazzcashNumber: appData.settings.jazzcashNumber
                            } : {};
                            
                            appData = importedData;
                            // Restore the admin settings over the imported data
                            if(appData) Object.assign(appData.settings, currentAdminSettings);

                            saveAppData();
                            alert("Data imported successfully! The app will now reload.");
                            location.reload();
                        }
                    );
                } else {
                     alert("Import failed. The selected file is not a valid Zee Mini backup file.");
                }
            } catch (error) {
                console.error("Failed to import data:", error);
                alert("An error occurred while reading or parsing the file. Please ensure it's a valid backup file.");
            }
        };
        reader.onerror = () => {
             alert("An error occurred while reading the file.");
        };
        reader.readAsText(file);
    };
    fileInput.click();
}


// --- START APP ---
document.addEventListener('DOMContentLoaded', initApp);