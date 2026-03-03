// Minimal server-authoritative Durak engine (2 players, classic rules simplified)
// State is fully server-side; moves validated here.

export type DurakPlayer = 'p1' | 'p2';
export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type Card = `${Rank}${Suit}`;

export interface DurakState {
  trump: Suit;
  deck: Card[];
  table: { attack: Card; defense?: Card }[];
  hands: Record<DurakPlayer, Card[]>;
  attacker: DurakPlayer;
  defender: DurakPlayer;
  phase: 'attack' | 'defend' | 'cleanup' | 'finished';
  winner?: DurakPlayer | 'draw';
  discard: Card[];
}

export type DurakMove =
  | { type: 'attack'; card: Card }
  | { type: 'defend'; attackCard: Card; defenseCard: Card }
  | { type: 'take' }
  | { type: 'end_turn' };

const suits: Suit[] = ['♠', '♥', '♦', '♣'];
const ranks: Rank[] = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of suits) for (const r of ranks) deck.push(`${r}${s}` as Card);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardSuit(c: Card): Suit {
  return c.slice(-1) as Suit;
}
function cardRankIndex(c: Card): number {
  const r = c.slice(0, -1);
  return ranks.indexOf(r as Rank);
}

export function createDurakEngine(): { state: DurakState; applyMove: (player: DurakPlayer, move: DurakMove) => { valid: boolean; error?: string; state: DurakState; outcome?: { status: 'win' | 'draw'; winner?: DurakPlayer } } } {
  const deck = buildDeck();
  const trumpCard = deck[deck.length - 1];
  const trump = cardSuit(trumpCard);
  const hands: Record<DurakPlayer, Card[]> = { p1: [], p2: [] };
  const draw = (p: DurakPlayer, n: number) => {
    for (let i = 0; i < n && deck.length; i++) hands[p].push(deck.pop()!);
  };
  draw('p1', 6);
  draw('p2', 6);

  const attacker: DurakPlayer = 'p1';
  const defender: DurakPlayer = 'p2';

  const state: DurakState = {
    trump,
    deck,
    table: [],
    hands,
    attacker,
    defender,
    phase: 'attack',
    discard: []
  };

  const canBeat = (attack: Card, defense: Card) => {
    const sa = cardSuit(attack);
    const sd = cardSuit(defense);
    if (sd === sa && cardRankIndex(defense) > cardRankIndex(attack)) return true;
    if (sd === state.trump && sa !== state.trump) return true;
    return false;
  };

  const refillHands = () => {
    const order: DurakPlayer[] = [state.attacker, state.defender];
    for (const p of order) {
      const need = Math.max(0, 6 - state.hands[p].length);
      for (let i = 0; i < need && state.deck.length; i++) state.hands[p].push(state.deck.pop()!);
    }
  };

  const maybeFinish = (): DurakPlayer | 'draw' | undefined => {
    const p1Empty = state.hands.p1.length === 0;
    const p2Empty = state.hands.p2.length === 0;
    if (p1Empty && p2Empty) return 'draw';
    if (p1Empty) return 'p1';
    if (p2Empty) return 'p2';
    if (state.deck.length === 0 && state.table.length === 0 && (p1Empty || p2Empty)) {
      if (p1Empty) return 'p1';
      if (p2Empty) return 'p2';
    }
    return undefined;
  };

  const applyMove = (player: DurakPlayer, move: DurakMove) => {
    // clone to avoid mutating if invalid
    const s = state;

    if (s.phase === 'finished') return { valid: false, error: 'finished', state: s };

    if (move.type === 'attack') {
      if (s.attacker !== player || s.phase !== 'attack') return { valid: false, error: 'not attacker', state: s };
      if (!s.hands[player].includes(move.card)) return { valid: false, error: 'no card', state: s };
      // if table non-empty, card rank must match any rank on table
      if (s.table.length) {
        const ranksOnTable = new Set(s.table.flatMap((p) => [p.attack, p.defense]).filter(Boolean).map((c) => c!.slice(0, -1)));
        if (!ranksOnTable.has(move.card.slice(0, -1))) return { valid: false, error: 'rank mismatch', state: s };
      }
      s.hands[player] = s.hands[player].filter((c) => c !== move.card);
      s.table.push({ attack: move.card });
      return { valid: true, state: s };
    }

    if (move.type === 'defend') {
      if (s.defender !== player || s.phase !== 'attack') return { valid: false, error: 'not defender', state: s };
      const pair = s.table.find((p) => p.attack === move.attackCard && !p.defense);
      if (!pair) return { valid: false, error: 'attack not found', state: s };
      if (!s.hands[player].includes(move.defenseCard)) return { valid: false, error: 'no card', state: s };
      if (!canBeat(pair.attack, move.defenseCard)) return { valid: false, error: 'cannot beat', state: s };
      pair.defense = move.defenseCard;
      s.hands[player] = s.hands[player].filter((c) => c !== move.defenseCard);
      return { valid: true, state: s };
    }

    if (move.type === 'take') {
      if (s.defender !== player) return { valid: false, error: 'not defender', state: s };
      // defender takes all
      const toTake = s.table.flatMap((p) => [p.attack, p.defense].filter(Boolean)) as Card[];
      s.hands[player].push(...toTake);
      s.table = [];
      s.phase = 'cleanup';
      return { valid: true, state: s };
    }

    if (move.type === 'end_turn') {
      if (player !== s.attacker && player !== s.defender) return { valid: false, error: 'not participant', state: s };
      // only attacker can end after at least one attack, or defender after all defended
      const allDefended = s.table.length > 0 && s.table.every((p) => p.defense);
      if (!allDefended) return { valid: false, error: 'not all defended', state: s };
      // discard
      s.discard.push(...(s.table.flatMap((p) => [p.attack, p.defense]) as Card[]));
      s.table = [];
      // swap roles
      const prevAttacker = s.attacker;
      s.attacker = s.defender;
      s.defender = prevAttacker;
      s.phase = 'attack';
      refillHands();
      const win = maybeFinish();
      if (win) {
        s.phase = 'finished';
        s.winner = win === 'draw' ? 'draw' : win;
        return { valid: true, state: s, outcome: { status: 'win', winner: win === 'draw' ? undefined : win } };
      }
      return { valid: true, state: s };
    }

    return { valid: false, error: 'unknown', state: s };
  };

  return { state, applyMove };
}
