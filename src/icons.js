function wrap(inner) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

module.exports = {
  message: wrap('<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>'),

  alertTriangle: wrap(
    '<path d="M12 2 22.5 21H1.5Z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/>'
  ),

  truck: wrap(
    '<rect x="1" y="6" width="13" height="11"/><path d="M14 10h4l3.5 3.5V17H14Z"/><circle cx="6" cy="19.5" r="1.7"/><circle cx="18" cy="19.5" r="1.7"/>'
  ),

  briefcase: wrap(
    '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="2" y1="13" x2="22" y2="13"/>'
  ),

  users: wrap(
    '<circle cx="9" cy="8" r="3.3"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><circle cx="17.5" cy="8.8" r="2.7"/><path d="M15.8 13.7c2.7.6 4.7 3 4.7 6.3"/>'
  ),

  plus: wrap('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),

  edit: wrap(
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4.5 1L4.5 14.5Z"/>'
  ),

  trash: wrap(
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'
  ),

  eye: wrap('<path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>'),

  logOut: wrap(
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'
  ),

  arrowLeft: wrap('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),

  inbox: wrap(
    '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.6 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.4A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.6Z"/>'
  ),

  bot: wrap(
    '<rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none"/><line x1="12" y1="8" x2="12" y2="4"/><circle cx="12" cy="3" r="1" fill="currentColor" stroke="none"/><line x1="1" y1="13" x2="4" y2="13"/><line x1="20" y1="13" x2="23" y2="13"/>'
  ),

  refresh: wrap('<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 9 8 9"/>'),

  package: wrap(
    '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5"/><line x1="12" y1="13" x2="12" y2="21"/>'
  ),

  save: wrap(
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>'
  ),

  search: wrap('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>'),

  upload: wrap(
    '<path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/><polyline points="8 8 12 4 16 8"/><line x1="12" y1="4" x2="12" y2="15"/>'
  ),

  check: wrap('<polyline points="20 6 9 17 4 12"/>'),

  fileText: wrap(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>'
  ),

  mail: wrap(
    '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><polyline points="2 6 12 13 22 6"/>'
  ),

  lock: wrap(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
  ),
};
