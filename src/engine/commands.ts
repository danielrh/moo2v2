// Player command validation + application. Commands mutate ORDERS/intents on a
// structuredClone of the state; the world itself changes only during turn
// resolution (pipeline.ts). Validation runs both client-side (optimistic UX)
// and host-side (authoritative).

import { applicationById, buildableById, fieldById, fieldByNum, applicationsOfField } from './data/index';
import { buyCost, colonyOutput, colonyPopUnits, empireOf, traitsOf } from './economy';
import { canQueue } from './items';
import { inRange, shipStar, travelTurns } from './movement';
import { availableFields } from './research';
import type { Colony, GameState, PopGroup, Ship } from './types';

export interface EngineCommand {
  turn: number;
  playerId: number;
  kind: string;
  payload: unknown;
}

type Validator = (state: GameState, cmd: EngineCommand) => string | null;
type Applier = (state: GameState, cmd: EngineCommand) => void;

function colony(state: GameState, id: unknown): Colony | null {
  return state.colonies.find((c) => c.id === id) ?? null;
}

function ownColony(state: GameState, cmd: EngineCommand, id: unknown): Colony | string {
  const c = colony(state, id);
  if (!c) return `no colony ${id}`;
  if (c.owner !== cmd.playerId) return `colony ${id} not yours`;
  if (c.outpost) return `colony ${id} is an outpost`;
  return c;
}

function ownShips(state: GameState, cmd: EngineCommand, ids: unknown): Ship[] | string {
  if (!Array.isArray(ids) || ids.length === 0) return 'no ships listed';
  const out: Ship[] = [];
  for (const id of ids) {
    const s = state.ships.find((x) => x.id === id);
    if (!s) return `no ship ${id}`;
    if (s.owner !== cmd.playerId) return `ship ${id} not yours`;
    out.push(s);
  }
  return out;
}

// ---------- set_jobs ----------

interface SetJobsPayload {
  colonyId: number;
  groups: Array<{ race: number; farmers: number; workers: number; scientists: number }>;
}

const validateSetJobs: Validator = (state, cmd) => {
  const p = cmd.payload as SetJobsPayload;
  const c = ownColony(state, cmd, p?.colonyId);
  if (typeof c === 'string') return c;
  if (!Array.isArray(p.groups)) return 'groups required';
  for (const g of p.groups) {
    const grp = c.groups.find((x) => x.race === g.race);
    if (!grp) return `no pop group for race ${g.race}`;
    const units = Math.floor(grp.popK / 1000);
    for (const key of ['farmers', 'workers', 'scientists'] as const) {
      if (!Number.isSafeInteger(g[key]) || g[key] < 0) return `bad ${key}`;
    }
    if (g.farmers + g.workers + g.scientists !== units) {
      return `jobs must total ${units} for race ${g.race}`;
    }
  }
  return null;
};

const applySetJobs: Applier = (state, cmd) => {
  const p = cmd.payload as SetJobsPayload;
  const c = colony(state, p.colonyId)!;
  for (const g of p.groups) {
    const grp = c.groups.find((x) => x.race === g.race)!;
    grp.farmers = g.farmers;
    grp.workers = g.workers;
    grp.scientists = g.scientists;
  }
};

// ---------- set_build_queue ----------

interface SetQueuePayload {
  colonyId: number;
  items: string[];
}

const validateSetQueue: Validator = (state, cmd) => {
  const p = cmd.payload as SetQueuePayload;
  const c = ownColony(state, cmd, p?.colonyId);
  if (typeof c === 'string') return c;
  if (!Array.isArray(p.items) || p.items.length > 12) return 'items must be a list (max 12)';
  const probe: Colony = { ...c, queue: [] };
  for (const item of p.items) {
    const err = canQueue(state, probe, item);
    if (err) return err;
    probe.queue = [...probe.queue, { item }];
  }
  return null;
};

const applySetQueue: Applier = (state, cmd) => {
  const p = cmd.payload as SetQueuePayload;
  const c = colony(state, p.colonyId)!;
  const oldActive = c.queue[0]?.item;
  c.queue = p.items.map((item) => ({ item }));
  const newActive = c.queue[0]?.item;
  if (oldActive && oldActive !== newActive) {
    if (state.settings.modes.stickyBuild) {
      // park progress on the switched-away item
      if (c.storedProd > 0) {
        c.stickyInvested[oldActive] = (c.stickyInvested[oldActive] ?? 0) + c.storedProd;
        c.storedProd = 0;
      }
    }
    // normal mode: storedProd carries to the new item (classic behavior)
  }
  if (newActive && state.settings.modes.stickyBuild && c.stickyInvested[newActive]) {
    c.storedProd += c.stickyInvested[newActive]!;
    delete c.stickyInvested[newActive];
  }
};

// ---------- buy_production ----------

interface BuyPayload {
  colonyId: number;
}

const validateBuy: Validator = (state, cmd) => {
  const p = cmd.payload as BuyPayload;
  const c = ownColony(state, cmd, p?.colonyId);
  if (typeof c === 'string') return c;
  const active = c.queue[0]?.item;
  if (!active) return 'nothing being built';
  if (active === 'housing' || active === 'trade_goods') return `cannot buy ${active}`;
  if (c.boughtThisTurn) return 'already bought this turn';
  const cost = buildableById.get(active)?.cost ?? 0;
  if (c.storedProd >= cost) return 'already complete';
  const price = buyCost(cost, c.storedProd);
  const empire = empireOf(state, cmd.playerId);
  if (empire.bc < price) return `need ${price} BC (have ${empire.bc})`;
  return null;
};

const applyBuy: Applier = (state, cmd) => {
  const p = cmd.payload as BuyPayload;
  const c = colony(state, p.colonyId)!;
  const active = c.queue[0]!.item;
  const cost = buildableById.get(active)?.cost ?? 0;
  const price = buyCost(cost, c.storedProd);
  const empire = empireOf(state, cmd.playerId);
  empire.bc -= price;
  c.storedProd = cost;
  c.boughtThisTurn = true;
};

// ---------- set_research ----------

interface SetResearchPayload {
  fieldNum: number;
  targetApp: string | null;
}

const validateSetResearch: Validator = (state, cmd) => {
  const p = cmd.payload as SetResearchPayload;
  const empire = state.empires.find((e) => e.id === cmd.playerId);
  if (!empire) return 'no empire';
  const field = fieldByNum.get(p?.fieldNum);
  if (!field) return `no field ${p?.fieldNum}`;
  if (!availableFields(empire).some((f) => f.num === field.num)) {
    return `${field.id} not available`;
  }
  if (p.targetApp !== null) {
    const apps = applicationsOfField(field.id);
    if (!apps.some((a) => a.id === p.targetApp)) return `${p.targetApp} not in ${field.id}`;
    if (empire.knownApps.includes(p.targetApp)) return `${p.targetApp} already known`;
  }
  const traits = traitsOf(empire);
  if (!traits.uncreative && !(traits.creative && !state.settings.modes.creativeVariant)) {
    if (p.targetApp === null && !field.id.startsWith('advf_')) return 'target application required';
  }
  return null;
};

const applySetResearch: Applier = (state, cmd) => {
  const p = cmd.payload as SetResearchPayload;
  const empire = empireOf(state, cmd.playerId);
  empire.research.fieldNum = p.fieldNum;
  empire.research.targetApp = p.targetApp;
};

// ---------- queue_extra_research (creative-variant) ----------

interface ExtraResearchPayload {
  appId: string;
  remove?: boolean;
}

const validateExtraResearch: Validator = (state, cmd) => {
  if (!state.settings.modes.creativeVariant) return 'creative-variant mode is off';
  const p = cmd.payload as ExtraResearchPayload;
  const empire = state.empires.find((e) => e.id === cmd.playerId);
  if (!empire) return 'no empire';
  if (!traitsOf(empire).creative) return 'only creative races may buy extra applications';
  if (p.remove) {
    return empire.research.extraQueue.includes(p.appId) ? null : `${p.appId} not queued`;
  }
  const found = applicationById.get(p.appId);
  if (!found) return `no application ${p.appId}`;
  const field = fieldById.get(found.fieldId);
  if (!field) return 'field missing';
  if (!empire.completedFields.includes(field.num)) return `${field.id} not completed`;
  if (empire.knownApps.includes(p.appId)) return `${p.appId} already known`;
  if (empire.research.extraQueue.includes(p.appId)) return `${p.appId} already queued`;
  return null;
};

const applyExtraResearch: Applier = (state, cmd) => {
  const p = cmd.payload as ExtraResearchPayload;
  const empire = empireOf(state, cmd.playerId);
  if (p.remove) {
    empire.research.extraQueue = empire.research.extraQueue.filter((a) => a !== p.appId);
    if (empire.research.extraQueue.length === 0) empire.research.extraAccumRP = 0;
  } else {
    empire.research.extraQueue.push(p.appId);
  }
};

// ---------- move_ships ----------

interface MovePayload {
  shipIds: number[];
  destStarId: number;
}

const validateMove: Validator = (state, cmd) => {
  const p = cmd.payload as MovePayload;
  const ships = ownShips(state, cmd, p?.shipIds);
  if (typeof ships === 'string') return ships;
  const dest = state.stars.find((s) => s.id === p.destStarId);
  if (!dest) return `no star ${p.destStarId}`;
  for (const ship of ships) {
    if (ship.location.kind !== 'star') return `ship ${ship.id} is in transit`;
    if (ship.location.starId === dest.id) return `ship ${ship.id} already there`;
  }
  if (!inRange(state, cmd.playerId, dest)) return `${dest.name} is out of fuel range`;
  return null;
};

const applyMove: Applier = (state, cmd) => {
  const p = cmd.payload as MovePayload;
  const empire = empireOf(state, cmd.playerId);
  for (const id of p.shipIds) {
    const ship = state.ships.find((s) => s.id === id)!;
    const from = shipStar(state, ship)!;
    const dest = state.stars.find((s) => s.id === p.destStarId)!;
    const turns = travelTurns(state, empire, from, dest);
    ship.location = {
      kind: 'transit',
      from: from.id,
      to: dest.id,
      departedTurn: state.turn,
      arrivalTurn: state.turn + turns,
    };
  }
};

// ---------- colonize / build_outpost ----------

interface ColonizePayload {
  shipId: number;
  planetId: number;
}

function validateSettle(state: GameState, cmd: EngineCommand, wantKind: 'colony_ship' | 'outpost_ship'): string | null {
  const p = cmd.payload as ColonizePayload;
  const ships = ownShips(state, cmd, [p?.shipId]);
  if (typeof ships === 'string') return ships;
  const ship = ships[0]!;
  if (ship.shipKind !== wantKind) return `ship ${ship.id} is not a ${wantKind}`;
  if (ship.location.kind !== 'star') return 'ship is in transit';
  const planet = state.planets.find((x) => x.id === p.planetId);
  if (!planet) return `no planet ${p.planetId}`;
  if (planet.starId !== ship.location.starId) return 'ship is not at that system';
  if (wantKind === 'colony_ship' && planet.body !== 'planet') return 'cannot colonize that body';
  if (state.colonies.some((c) => c.planetId === planet.id)) return 'already settled';
  return null;
}

const applyColonize: Applier = (state, cmd) => {
  const p = cmd.payload as ColonizePayload;
  const ship = state.ships.find((s) => s.id === p.shipId)!;
  const planet = state.planets.find((x) => x.id === p.planetId)!;
  const star = state.stars.find((s) => s.id === planet.starId)!;
  state.ships = state.ships.filter((s) => s.id !== ship.id);
  const romans = ['I', 'II', 'III', 'IV', 'V'];
  state.colonies.push({
    id: state.nextId++,
    planetId: planet.id,
    owner: cmd.playerId,
    name: `${star.name} ${romans[planet.orbit - 1] ?? planet.orbit}`,
    groups: [{ race: cmd.playerId, popK: 1000, farmers: 1, workers: 0, scientists: 0 }],
    buildings: [],
    queue: [],
    storedProd: 0,
    stickyInvested: {},
    boughtThisTurn: false,
    foodLackPrev: 0,
    prodLackPrev: 0,
    housingPPPrev: 0,
    outpost: false,
  });
  state.colonies.sort((a, b) => a.id - b.id);
};

const applyOutpost: Applier = (state, cmd) => {
  const p = cmd.payload as ColonizePayload;
  const ship = state.ships.find((s) => s.id === p.shipId)!;
  const planet = state.planets.find((x) => x.id === p.planetId)!;
  const star = state.stars.find((s) => s.id === planet.starId)!;
  state.ships = state.ships.filter((s) => s.id !== ship.id);
  state.colonies.push({
    id: state.nextId++,
    planetId: planet.id,
    owner: cmd.playerId,
    name: `${star.name} Outpost`,
    groups: [],
    buildings: [],
    queue: [],
    storedProd: 0,
    stickyInvested: {},
    boughtThisTurn: false,
    foodLackPrev: 0,
    prodLackPrev: 0,
    housingPPPrev: 0,
    outpost: true,
  });
  state.colonies.sort((a, b) => a.id - b.id);
};

// ---------- scrap_ship ----------

const validateScrap: Validator = (state, cmd) => {
  const p = cmd.payload as { shipId: number };
  const ships = ownShips(state, cmd, [p?.shipId]);
  return typeof ships === 'string' ? ships : null;
};

const applyScrap: Applier = (state, cmd) => {
  const p = cmd.payload as { shipId: number };
  const ship = state.ships.find((s) => s.id === p.shipId)!;
  const empire = empireOf(state, cmd.playerId);
  const costs: Record<string, number> = { colony_ship: 500, outpost_ship: 100, transport: 100, scout: 10 };
  empire.bc += Math.floor((costs[ship.shipKind] ?? 0) / 2);
  state.ships = state.ships.filter((s) => s.id !== p.shipId);
};

// ---------- debug commands (settings-gated, still deterministic + logged) ----------

const validateDebug: Validator = (state) =>
  state.settings.debugCommands ? null : 'debug commands disabled';

const applyDebugGrantApp: Applier = (state, cmd) => {
  const p = cmd.payload as { appId: string };
  const empire = empireOf(state, cmd.playerId);
  if (!empire.knownApps.includes(p.appId)) {
    empire.knownApps.push(p.appId);
    empire.knownApps.sort();
  }
};

const applyDebugAddBc: Applier = (state, cmd) => {
  const p = cmd.payload as { amount: number };
  empireOf(state, cmd.playerId).bc += p.amount;
};

const applyDebugSetPop: Applier = (state, cmd) => {
  const p = cmd.payload as { colonyId: number; popK: number };
  const c = colony(state, p.colonyId);
  if (c && c.groups[0]) {
    c.groups[0].popK = p.popK;
    normalizeJobsForGroup(c.groups[0]);
  }
};

function normalizeJobsForGroup(g: PopGroup): void {
  const units = Math.floor(g.popK / 1000);
  let assigned = g.farmers + g.workers + g.scientists;
  while (assigned > units) {
    if (g.scientists > 0) g.scientists--;
    else if (g.workers > 0) g.workers--;
    else if (g.farmers > 0) g.farmers--;
    assigned--;
  }
  while (assigned < units) {
    g.workers++;
    assigned++;
  }
}

// ---------- registry ----------

export const COMMANDS: Record<string, { validate: Validator; apply: Applier }> = {
  set_jobs: { validate: validateSetJobs, apply: applySetJobs },
  set_build_queue: { validate: validateSetQueue, apply: applySetQueue },
  buy_production: { validate: validateBuy, apply: applyBuy },
  set_research: { validate: validateSetResearch, apply: applySetResearch },
  queue_extra_research: { validate: validateExtraResearch, apply: applyExtraResearch },
  move_ships: { validate: validateMove, apply: applyMove },
  colonize: {
    validate: (s, c) => validateSettle(s, c, 'colony_ship'),
    apply: applyColonize,
  },
  build_outpost: {
    validate: (s, c) => validateSettle(s, c, 'outpost_ship'),
    apply: applyOutpost,
  },
  scrap_ship: { validate: validateScrap, apply: applyScrap },
  debug_grant_app: { validate: validateDebug, apply: applyDebugGrantApp },
  debug_add_bc: { validate: validateDebug, apply: applyDebugAddBc },
  debug_set_pop: { validate: validateDebug, apply: applyDebugSetPop },
};

export function validateCommand(state: GameState, cmd: EngineCommand): string | null {
  if (cmd.playerId >= 0) {
    const empire = state.empires.find((e) => e.id === cmd.playerId);
    if (!empire) return `no empire for player ${cmd.playerId}`;
    if (empire.eliminated) return 'empire eliminated';
    if (cmd.turn !== state.turn) return `command for turn ${cmd.turn}, current ${state.turn}`;
  }
  const def = COMMANDS[cmd.kind];
  if (!def) return `unknown command ${cmd.kind}`;
  return def.validate(state, cmd);
}

export function applyCommand(state: GameState, cmd: EngineCommand): void {
  const def = COMMANDS[cmd.kind];
  if (!def) throw new Error(`unknown command ${cmd.kind}`);
  def.apply(state, cmd);
}

export { normalizeJobsForGroup };
