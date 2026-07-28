// lib/pic-view.ts
//
// PIC users default to the desktop /pic panel, but still need to do their
// own personal tasks (attendance, grooming, etc.) which live in the mobile
// employee app. This cookie is the on/off switch for "let this PIC see the
// mobile employee app on a desktop-sized viewport instead of being bounced
// to /pic". Presence = on. No value semantics beyond that.
export const EMPLOYEE_VIEW_COOKIE = 'pic_employee_view';

// 12 hours — long enough for a work session, short enough that a forgotten
// switch doesn't quietly strand a PIC out of the panel for days.
const EMPLOYEE_VIEW_MAX_AGE_S = 12 * 60 * 60;

/**
 * Turns the cookie on. Kept as a plain top-level function (not inlined in a
 * component) so the `document.cookie` mutation doesn't sit inside render
 * output that the React Compiler tries to memoize.
 */
export function setEmployeeViewCookie() {
  document.cookie = `${EMPLOYEE_VIEW_COOKIE}=1; path=/; max-age=${EMPLOYEE_VIEW_MAX_AGE_S}`;
}
