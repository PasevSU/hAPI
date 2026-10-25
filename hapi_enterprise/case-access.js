'use strict';
// ОГРАНИЧАВАНЕ ПО ДЕЛО (план 17, F7-1, DoD „достъп по дело“).
//
// ЗАЩО СЪЩЕСТВУВА
// Съдебните роли (`judge`, `prosecutor`, `clerk`, `expert`) четат доказателства, но досега
// виждаха ВСИЧКИ — включително на дела, по които не работят. За съд това е недопустимо:
// достъпът трябва да следва делото, а не ролята. Тук е правилото, на едно място, за да не се
// разминава между маршрутите.
//
// КАК РАБОТИ
//   • `admin`, `operator`, `viewer` НЕ се ограничават — те не са съдебни роли и виждат това,
//     което и досега (промяната не бива да чупи работеща инсталация).
//   • Съдебна роля вижда порталите на делата, които ѝ е ЗАДАДЕНО. Без зададено дело не вижда
//     НИЩО — fail-closed, защото „забравено назначение“ не бива да значи „вижда всичко“.
//   • `*` в назначенията значи всички дела и се дава съзнателно, не по подразбиране.
//   • Портал без `caseId` (несвързан с дело) НЕ се вижда от съдебна роля: ако не знаем кое
//     дело е, не можем да кажем, че съдът има право на него.
//
// КАКВО НЕ ПРАВИ
//   • Не решава кой ЗАДАВА назначенията — това е административно право, проверено в маршрута.
//   • Не пази нищо само: правилата са чисти функции, за да се тестват без сървър.

const COURT_ROLES = ['judge', 'prosecutor', 'clerk', 'expert'];

/** Съдебна роля ли е? Само за тях ограничението важи. */
const isCourtRole = (role) => COURT_ROLES.includes(role);

/**
 * Разрешените id на портали за дадена роля и назначения.
 * Връща `null`, когато ограничение НЯМА (не-съдебна роля) — разликата между „всичко“ и
 * „нищо“ трябва да е видима, а не да се гадае по празен масив.
 */
function allowedPortalIds({ role, assignments, portals }) {
  if (!isCourtRole(role)) return null; // няма ограничение
  const mine = Array.isArray(assignments) ? assignments.filter(Boolean).map(String) : [];
  if (!mine.length) return []; // fail-closed: без назначение — нищо
  const all = mine.includes('*');
  const list = Array.isArray(portals) ? portals : [];
  return list
    // Портал без `caseId` е невидим за съда: не знаем кое дело е.
    .filter((p) => p && p.caseId && (all || mine.includes(String(p.caseId))))
    .map((p) => String(p.id));
}

/**
 * Причината, с думи — защото „403“ без обяснение не помага на съдия, който просто не е
 * назначен по делото.
 */
function explain({ role, assignments, portals }) {
  if (!isCourtRole(role)) return { restricted: false, reason: '' };
  const ids = allowedPortalIds({ role, assignments, portals });
  if (ids.length) return { restricted: true, reason: '' };
  const mine = Array.isArray(assignments) ? assignments.filter(Boolean) : [];
  if (!mine.length) return { restricted: true, reason: 'NO_CASE_ASSIGNED' };
  return { restricted: true, reason: 'NO_PORTAL_IN_ASSIGNED_CASES' };
}

/** Може ли ролята да види конкретен портал? */
function canSee({ role, assignments, portal }) {
  if (!isCourtRole(role)) return true;
  const ids = allowedPortalIds({ role, assignments, portals: [portal] });
  return ids.length > 0;
}

module.exports = { COURT_ROLES, isCourtRole, allowedPortalIds, explain, canSee };
