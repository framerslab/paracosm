import type { Agent, Department, HexacoProfile } from './state.js';
import { SeededRng } from './rng.js';

function randomHexaco(rng: SeededRng): HexacoProfile {
  return {
    openness: 0.2 + rng.next() * 0.6,
    conscientiousness: 0.2 + rng.next() * 0.6,
    extraversion: 0.2 + rng.next() * 0.6,
    agreeableness: 0.2 + rng.next() * 0.6,
    emotionality: 0.2 + rng.next() * 0.6,
    honestyHumility: 0.2 + rng.next() * 0.6,
  };
}

const FIRST_NAMES = [
  'Aria', 'Dietrich', 'Yuki', 'Marcus', 'Elena', 'Kwame', 'Sofia', 'Jin',
  'Amara', 'Liam', 'Priya', 'Omar', 'Mei', 'Carlos', 'Ingrid', 'Tariq',
  'Nadia', 'Henrik', 'Aisha', 'Pavel', 'Luna', 'Ravi', 'Zara', 'Felix',
  'Anya', 'Diego', 'Kira', 'Hassan', 'Signe', 'Jamal', 'Mila', 'Chen',
  'Fatima', 'Anders', 'Keiko', 'David', 'Olga', 'Kofi', 'Leila', 'Sven',
  'Rosa', 'Idris', 'Hana', 'Bruno', 'Daria', 'Emeka', 'Yara', 'Tomas',
  'Nia', 'Viktor',
];

const LAST_NAMES = [
  'Chen', 'Voss', 'Tanaka', 'Webb', 'Kowalski', 'Okafor', 'Petrov', 'Kim',
  'Santos', 'Johansson', 'Patel', 'Al-Rashid', 'Nakamura', 'Fernandez', 'Berg',
  'Ibrahim', 'Volkov', 'Singh', 'Torres', 'Andersen', 'Müller', 'Zhang',
  'Osei', 'Larsson', 'Ahmad', 'Costa', 'Ivanova', 'Park', 'Eriksson', 'Diallo',
  'Sato', 'Rivera', 'Lindqvist', 'Mensah', 'Kato', 'Morales', 'Holm', 'Yusuf',
  'Takahashi', 'Reyes', 'Nkomo', 'Li', 'Herrera', 'Bakker', 'Ito', 'Mendez',
  'Dahl', 'Owusu', 'Yamamoto', 'Cruz',
];

const SPECIALIZATIONS: Record<Department, string[]> = {
  medical: ['General Medicine', 'Radiation Medicine', 'Surgery', 'Psychiatry', 'Emergency Medicine'],
  engineering: ['Structural', 'Life Support', 'Power Systems', 'Communications', 'Robotics'],
  agriculture: ['Hydroponics', 'Soil Science', 'Botany', 'Nutrition', 'Water Systems'],
  science: ['Geology', 'Atmospheric Science', 'Biology', 'Chemistry', 'Astrophysics'],
  administration: ['Operations', 'Logistics', 'HR', 'Communications', 'Planning'],
  psychology: ['Clinical Psychology', 'Social Psychology', 'Occupational Therapy'],
  governance: ['Policy', 'Law', 'Diplomacy'],
};

const DEPARTMENT_DISTRIBUTION: Department[] = [
  'engineering', 'engineering', 'engineering', 'engineering',
  'medical', 'medical', 'medical',
  'agriculture', 'agriculture', 'agriculture',
  'science', 'science', 'science',
  'administration', 'administration',
  'psychology',
];

export interface KeyPersonnel {
  name: string;
  department: Department;
  role: string;
  specialization: string;
  age: number;
  featured: boolean;
}

/** Latin letters that carry no combining accent, spelled in plain letters. */
const PLAIN_LETTERS: Record<string, string> = {
  'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ı': 'i',
};

/** Lowercase with accents folded: "José" reads as "jose", "Søren" as "soren". */
function foldName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[øłđðþæœßı]/g, c => PLAIN_LETTERS[c]);
}

/** Anything that is not a letter, a combining mark or a digit, in any alphabet. */
const NOT_WORD = /[^\p{L}\p{M}\p{N}]+/gu;

/**
 * The roster id for a person's name: `col-` and the name's words in
 * lowercase, joined by hyphens. Accents are folded and periods and
 * apostrophes drop out, so "Dr. Priya Singh" is `col-dr-priya-singh`
 * and "Aoife O'Brien" is `col-aoife-obrien`, the forms a model writes
 * back when it names them; a Latin name gives only letters, digits and
 * hyphens. Letters of other alphabets stay as they are ("Олег Иванов"
 * is `col-олег-иванов`), so two such names never share an id.
 * {@link generateInitialPopulation} adds -2, -3 and so on when two
 * names still give the same id ("José Silva" and "Jose Silva").
 */
export function agentIdFromName(name: string): string {
  const slug = foldName(name)
    .replace(/['\u2019.]/g, '')
    .replace(NOT_WORD, '-')
    .replace(/^-+|-+$/g, '');
  return `col-${slug || 'agent'}`;
}

const TITLES = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'mx']);

/**
 * Comparison keys for an agent id a model wrote, loosest last: the id
 * with everything but letters, marks and digits dropped, then the same
 * without a leading title ("col-priya-singh" for "Dr. Priya Singh").
 * Saved runs hold ids made before {@link agentIdFromName}
 * ("col-dr.-priya-singh", "col-josé-silva"), and these keys match them
 * too.
 */
export function agentIdKeys(id: string): [string, string] {
  const words = foldName(id).split(NOT_WORD).filter(Boolean);
  const bare = words.join('');
  const rest = words[0] === 'col' ? words.slice(1) : words;
  const untitled = rest.length > 1 && TITLES.has(rest[0]) ? rest.slice(1) : rest;
  return [bare, untitled.join('')];
}

/** The id for `name`, with -2, -3 and so on when someone already holds it. */
function claimAgentId(name: string, usedIds: Set<string>): string {
  const base = agentIdFromName(name);
  let id = base;
  for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
  usedIds.add(id);
  return id;
}

/**
 * New adults who join a run already under way, in the departments and
 * specializations of the people on the roster, so a fork that has no
 * scenario to hand places them the same way. Returns none when nobody on
 * the roster can show where they would work. Nobody new takes the id or
 * the name of someone in `former`, the people who left: past snapshots
 * still hold them, and a reader follows a person through those by id.
 */
export function generateJoiners(
  rng: SeededRng,
  time: number,
  turn: number,
  count: number,
  roster: readonly Agent[],
  former: ReadonlyArray<{ id: string; name: string }> = [],
  yearsPerUnit = 1,
): Agent[] {
  const peers = roster.filter(a => a.health.alive && a.core.role !== 'Child');
  if (peers.length === 0) return [];
  const usedNames = new Set([...roster.map(a => a.core.name), ...former.map(p => p.name)]);
  const usedIds = new Set([...roster.map(a => a.core.id), ...former.map(p => p.id)]);
  const joiners: Agent[] = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    // A full name list falls through to a repeated name with its own id.
    for (let tries = 0; tries < 200; tries++) {
      name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!usedNames.has(name)) break;
    }
    usedNames.add(name);

    const peer = rng.pick(peers);
    const spec = peer.career.specialization;
    const age = rng.int(25, 55);
    const rank = age > 40 ? (rng.chance(0.3) ? 'lead' : 'senior') : (rng.chance(0.2) ? 'senior' : 'junior');
    const hexaco = randomHexaco(rng);
    const joiner = createColonist(
      claimAgentId(name, usedIds), name, time - age / yearsPerUnit, peer.core.department,
      `${rank.charAt(0).toUpperCase() + rank.slice(1)} ${spec} Specialist`,
      spec, false, false, hexaco, time,
    );
    joiner.career.rank = rank;
    joiner.career.yearsExperience = rng.int(2, age - 22);
    joiner.hexacoHistory = [{ turn, time, hexaco: { ...hexaco } }];
    joiner.narrative.lifeEvents.push({ time, event: `Joined as ${joiner.core.role}`, source: 'kernel' });
    joiners.push(joiner);
  }
  return joiners;
}

/**
 * Build a run's roster: the key personnel, then generated people up to
 * `totalPopulation`. With `departments`, the generated people work in
 * those departments under their labels. Without them they come from
 * Mars Genesis's own trades (DEPARTMENT_DISTRIBUTION, SPECIALIZATIONS).
 * Ages are in years; `yearsPerUnit` (years in one unit of the scenario's
 * time) places each birth time in the scenario's unit.
 */
export function generateInitialPopulation(
  seed: number,
  startTime: number,
  keyPersonnel: KeyPersonnel[],
  totalPopulation: number = 100,
  departments?: ReadonlyArray<{ id: Department; label: string }>,
  yearsPerUnit = 1,
): Agent[] {
  const rng = new SeededRng(seed);
  // Ages are in years; a birth time is in the scenario's unit.
  const bornAt = (age: number) => startTime - age / yearsPerUnit;
  const colonists: Agent[] = [];
  const usedNames = new Set<string>();
  const usedIds = new Set<string>();
  const claimId = (name: string): string => claimAgentId(name, usedIds);

  for (const kp of keyPersonnel) {
    usedNames.add(kp.name);
    colonists.push(createColonist(claimId(kp.name), kp.name, bornAt(kp.age), kp.department, kp.role, kp.specialization, false, kp.featured, randomHexaco(rng), startTime));
  }

  const remaining = Math.max(0, totalPopulation - keyPersonnel.length);
  for (let i = 0; i < remaining; i++) {
    let name: string;
    do {
      name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const own = departments ? rng.pick(departments) : undefined;
    const dept = own ? own.id : rng.pick(DEPARTMENT_DISTRIBUTION);
    const spec = own ? own.label || own.id : rng.pick(SPECIALIZATIONS[dept]);
    const age = rng.int(25, 55);
    const rank = age > 40 ? (rng.chance(0.3) ? 'lead' : 'senior') : (rng.chance(0.2) ? 'senior' : 'junior');

    const c = createColonist(
      claimId(name), name, bornAt(age), dept,
      `${rank.charAt(0).toUpperCase() + rank.slice(1)} ${spec} Specialist`,
      spec, false, false, randomHexaco(rng), startTime,
    );
    c.career.rank = rank as 'junior' | 'senior' | 'lead';
    c.career.yearsExperience = rng.int(2, age - 22);
    colonists.push(c);
  }

  return colonists;
}

function createColonist(
  id: string, name: string, birthTime: number, department: Department,
  role: string, specialization: string, marsborn: boolean, featured: boolean,
  hexaco: HexacoProfile, startTime: number,
): Agent {
  return {
    core: { id, name, birthTime, marsborn, department, role },
    health: { alive: true, boneDensityPct: marsborn ? 88 : 100, cumulativeRadiationMsv: 0, psychScore: 0.8, conditions: [] },
    career: { specialization, yearsExperience: 0, rank: 'senior', achievements: [] },
    social: { childrenIds: [], friendIds: [], earthContacts: marsborn ? 0 : 5 },
    narrative: { lifeEvents: [], featured },
    hexaco,
    hexacoHistory: [{ turn: 0, time: startTime, hexaco: { ...hexaco } }],
    memory: { shortTerm: [], longTerm: [], stances: {}, relationships: {} },
  };
}
