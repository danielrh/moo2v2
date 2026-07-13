import { ARMOR_MULT, ARMOR_NAMES, COMPUTER_APPS, DRIVE_APPS, SHIELD_APPS } from '@engine/index';
import { applicationById, MOD_FLAG_KEYS, weaponModById } from '@engine/data/index';

function appName(id: string, fallback: string): string {
  return applicationById.get(id)?.name ?? fallback;
}

function titleCaseWords(text: string): string {
  return text
    .split('_')
    .map((w) => (w[0] ?? '').toUpperCase() + w.slice(1))
    .join(' ');
}

export function computerNameForTier(tier: number): string {
  if (tier <= 0) return 'No Computer';
  const id = COMPUTER_APPS[tier - 1];
  return id ? appName(id, `Computer Mk ${tier}`) : `Computer Mk ${tier}`;
}

export function shieldNameForTier(tier: number): string {
  if (tier <= 0) return 'No Shield';
  const id = SHIELD_APPS[tier - 1];
  return id ? appName(id, `Class ${tier} Shield`) : `Class ${tier} Shield`;
}

export function driveNameForTier(tier: number): string {
  const clamped = Math.max(1, tier);
  const id = DRIVE_APPS[clamped - 1];
  return id ? appName(id, 'Drive') : 'Drive';
}

export function armorNameForTier(tier: number): string {
  const clamped = Math.max(1, Math.min(ARMOR_NAMES.length, tier));
  const base = ARMOR_NAMES[clamped - 1] ?? 'armor';
  return `${titleCaseWords(base)} Armor`;
}

export function driveTierOptions(): Array<{ tier: number; label: string }> {
  return DRIVE_APPS.map((_, i) => {
    const tier = i + 1;
    return { tier, label: `${tier} · ${driveNameForTier(tier)}` };
  });
}

export function armorTierOptions(): Array<{ tier: number; label: string }> {
  return ARMOR_NAMES.map((name, i) => {
    const tier = i + 1;
    return { tier, label: `${tier} · ${titleCaseWords(name)} ×${ARMOR_MULT[i]}` };
  });
}

export function weaponModTooltip(mod: string): string {
  const rowId = MOD_FLAG_KEYS[mod] as string | undefined;
  const row = rowId ? weaponModById.get(rowId) : undefined;
  const hint = row?.hint || 'Weapon behavior modifier.';
  if (!row) return `${mod.toUpperCase()}: ${hint}`;
  const plus = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return `${mod.toUpperCase()}: ${hint} Space ${plus(row.spacePercent)}%, cost ${plus(row.costPercent)}%.`;
}
