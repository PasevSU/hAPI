'use strict';
// Портал „само за преглед“ — СПЪТНИК на нормалния портал, не трети вид страница.
//
// Защо втори запис, а не параметър в адреса: `?view=1` не е защита. Всеки, който получи
// линка, може да махне параметъра и да получи пълния портал — а при публичен портал няма
// дори подпис, който да го спре. Затова спътникът е СВОЙ запис: собствен `id`, собствен
// `slug`, собствен `signingSecret`, собствен QR. Свалянето се решава от сървъра по
// `readonly: true` в записа, не по нещо, което идва от клиента.
//
// Какво прави политиката:
//   • файловете се отдават INLINE (преглед в браузъра), не като `attachment` — тоест
//     „само се гледат“, вместо да паднат в папката за сваляне;
//   • пакетът/ZIP (`/package`) е отказан изцяло: той е точно „свали всичко наведнъж“;
//   • запис, качване и триене не съществуват в публичните маршрути по начало.
const MAX_SLUG = 63;

/** slug на спътника: `<slug>-view` (съкратен, за да остане в лимита за slug). */
function readOnlySlug(slug) {
  const base = String(slug || '').trim().slice(0, MAX_SLUG - 5).replace(/-+$/, '');
  return base + '-view';
}

/** Само за преглед ли е порталът? Едно място, за да не се разминават проверките. */
function isReadonly(p) {
  return Boolean(p && p.readonly === true);
}

/**
 * Записът на спътника: същата папка, същите данни и същият достъп, но собствен идентификатор
 * и политика „само за преглед“. `files` е празен списък — файловете се виждат през папката
 * (`storage_root`), а не през копие на регистъра; така няма две истини за един файл.
 * @param {object} parent записът на нормалния портал
 * @param {{id: string, titleSuffix?: string, now?: string}} options
 */
function buildRecord(parent, { id, titleSuffix = ' (преглед)', now } = {}) {
  return {
    ...parent,
    id,
    slug: readOnlySlug(parent.slug),
    title: String(parent.title || '') + titleSuffix,
    readonly: true,
    parentId: parent.id,
    parentSlug: parent.slug,
    files: [],
    createdAt: now || new Date().toISOString(),
  };
}

/**
 * Създава спътника, ако е поискан и slug-ът е свободен. Никога не хвърля: порталът вече
 * съществува и „само за преглед“ е удобство, а не условие за успеха на създаването.
 * @param {object} deps `{db, id, fsp, filesRoot, qrRegistry, writeApiDir, baseUrl, getPortal}`
 * @param {object} parent
 * @param {boolean} enabled
 * @returns {Promise<object|null>} записът на спътника или `null`
 */
async function ensureView(deps, parent, enabled) {
  if (enabled !== true || !parent) return null;
  const { db, id, fsp, filesRoot, qrRegistry, writeApiDir, baseUrl, getPortal } = deps;
  const slug = readOnlySlug(parent.slug);
  if (typeof getPortal === 'function' && getPortal(slug)) return null;
  const view = buildRecord(parent, { id: id() });
  try {
    await fsp.mkdir(require('node:path').join(filesRoot, view.id), { recursive: true });
    db.portals.push(view);
    if (qrRegistry) qrRegistry.ensureFirst(db, view);
    if (writeApiDir) await writeApiDir(view, baseUrl);
  } catch {
    // Спътникът е отказан, но порталът остава създаден — тихо, за да не се губи резултатът.
    return null;
  }
  return view;
}

/** Опции за отдаването на файл: при „само за преглед“ — INLINE, иначе `attachment`. */
function downloadOptions(p) {
  return isReadonly(p) ? { inline: true } : {};
}

/** Може ли порталът да дава пакет/ZIP? Спътникът не може — това е „свали всичко“. */
function allowsPackage(p) {
  return !isReadonly(p);
}

module.exports = { MAX_SLUG, readOnlySlug, isReadonly, buildRecord, ensureView, downloadOptions, allowsPackage };
