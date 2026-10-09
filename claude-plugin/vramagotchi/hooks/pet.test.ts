import { expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'

declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown

const BAND = { plugin: 'vramagotchi', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as never

test('an egg hatches on its first meal, then the pet earns things and survives a compaction', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const kept: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000 }, rateLimits: [] } }) as never)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], usage: { input_tokens: 10, output_tokens: 12_000 } } as never
  })
  on('session.start', (_, e) => e as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push((e as unknown as { id: string }).id)

    return { value: { isOpen: true } } as never
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [], toolResults: [] }], tokensAfter: 8_000 }) as never)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await (await $.ui.mount(BAND)).find({ type: 'Text', text: /An egg!/ })).toBeTruthy()

  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 })) {
    // the pet eats
  }
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const pet = kept.pet as Save
  expect(pet.isHatched).toBe(true)
  expect(pet.lifetime).toBe(12_000)
  expect(pet.items).toEqual(expect.arrayContaining(['headphones', 'sweatband']))
  expect(pet.streak).toBe(1)

  await clock.advance(10_000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /baby \w+ · idle/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /context ██░░░░ 25%/ })).toBeTruthy()
  expect(await band.find({ type: 'Raster' })).toBeTruthy()

  // The desktop app has no character grid to paint, so there the same pet is an SVG.
  const desk = await $.ui.mount({ ...(BAND as object), surface: 'desktop' } as never)
  expect(await desk.find({ type: 'Text', text: /baby \w+ · idle/ })).toBeTruthy()
  expect(await desk.find({ type: 'Svg' })).toBeTruthy()
  expect(await desk.find({ type: 'Raster' })).toBeFalsy()

  // VS Code and the mobile app have no band, so there /pet window gives the pet a window of its own.
  await $.command.run({ command: 'pet', args: 'window' } as never)
  expect(opened).toEqual(['pet'])
  for (const surface of ['vscode', 'mobile'] as const) {
    const pane = await $.ui.mount({ plugin: 'vramagotchi', surface, component: 'Pane', requestId: 'pet', props: { title: 'Pet', isFocused: false, bodyColumns: 60, placement: 'inline' } } as never)
    expect(await pane.find({ type: 'Svg' })).toBeTruthy()
    expect(await pane.find({ type: 'Button', text: /Pet/ })).toBeTruthy()
    expect(await pane.find({ type: 'Button', text: /Hide/ })).toBeFalsy()
  }

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [], toolResults: [] }] } as never)
  expect((kept.pet as Save).items).toContain('bandage')
  expect(await (await $.ui.mount(BAND)).find({ type: 'Text', text: /context ░░░░░░ 4%/ })).toBeTruthy()
})

test('nothing reaches the leaderboard until the owner joins, and then only the pet', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  mock.env(on, { VRAMAGOTCHI_BOARD: 'https://board.test' })
  const kept: Record<string, unknown> = {}
  const sent: { url: string; method: string; body: Record<string, unknown> }[] = []
  on('store.get', (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined } as never
  })
  on('http.fetch', (_, e) => {
    const call = e as unknown as { url: string; init?: { method?: string; body?: string } }
    sent.push({ url: call.url, method: call.init?.method ?? 'GET', body: JSON.parse(call.init?.body ?? '{}') })

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ rank: 1, teamRank: 2, score: 12_000, pets: [], shiny: true, items: ['headphones', 'star'], found: ['star'] }) } } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000 }, rateLimits: [] } }) as never)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], usage: { input_tokens: 10, output_tokens: 12_000 } } as never
  })
  on('session.start', (_, e) => e as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const turn = async () => {
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 })) {
      // the pet eats
    }
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  }

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await turn()
  expect(sent).toEqual([])

  await $.command.run({ command: 'pet', args: 'name Mochi' } as never)
  const joined = await $.command.run({ command: 'pet', args: 'board join' } as never)
  expect(String((joined as { text?: string }).text)).toContain('Mochi is on the board')
  expect(sent.length).toBe(1)
  expect(sent[0]?.url).toBe('https://board.test/pets')
  expect(Object.keys(sent[0]?.body ?? {}).sort()).toEqual(['id', 'items', 'key', 'lifetime', 'name', 'public', 'species', 'wearing'])
  expect(sent[0]?.body.lifetime).toBe(12_000)
  expect(sent[0]?.body.public).toBe(true)

  // The board rolls the luck: what it says the pet found, and that it is shiny, is kept here.
  expect((kept.pet as Save).items).toContain('star')
  expect((kept.pet as Save).isShiny).toBe(true)

  await clock.advance(11 * 60_000)
  await turn()
  expect(sent.length).toBe(2)
  expect(sent[1]?.body.id).toBe(sent[0]?.body.id)
  const band = await $.ui.mount({ plugin: 'vramagotchi', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as never)
  expect(await band.find({ type: 'Text', text: /#1/ })).toBeTruthy()

  await $.command.run({ command: 'pet', args: 'board leave' } as never)
  expect(sent[2]?.method).toBe('DELETE')
  await clock.advance(11 * 60_000)
  await turn()
  expect(sent.length).toBe(3)

  // A team: the pet goes on its team's board without going on the public one.
  expect(String(((await $.command.run({ command: 'pet', args: 'team join nonsense' } as never)) as { text?: string }).text)).toContain('not a team code')
  const started = String(((await $.command.run({ command: 'pet', args: 'team new Acme Inc' } as never)) as { text?: string }).text)
  const code = /\/pet team join (acmeinc-[a-f0-9]{8})/.exec(started)?.[1]
  expect(code).toBeTruthy()
  expect(sent.length).toBe(4)
  expect(sent[3]?.body.team).toBe(code)
  expect(sent[3]?.body.public).toBe(false)
  expect(await (await $.ui.mount({ plugin: 'vramagotchi', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as never)).find({ type: 'Text', text: /#2/ })).toBeTruthy()
  await $.command.run({ command: 'pet', args: 'team leave' } as never)
  expect(sent[4]?.method).toBe('DELETE')
  expect((kept.pet as Save).team).toBe('')
})

test('the pet only remarks on a turn once its owner turns that on', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const kept: Record<string, unknown> = {}
  const asked: { system?: string; prompt: string; model: string }[] = []
  on('store.get', (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined } as never
  })
  on('model.complete', (_, e) => {
    asked.push((e as unknown as { request: { system?: string; prompt: string; model: string } }).request ?? (e as never))

    return { value: { isAnswered: true, text: '"Nobody ran the tests, did they?"', usage: {} } } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000 }, rateLimits: [] } }) as never)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], usage: { input_tokens: 10, output_tokens: 900 } } as never
  })
  on('session.start', (_, e) => e as never)
  on('turn.start', (_, e) => e as never)
  on('prompt.submit', (_, e) => e as never)
  on('tool.call', () => ({ result: {}, text: 'Tests: 3 failed, 12 passed', isError: true }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const answer = 'I rewrote the parser and updated three call sites. I did not run the test suite, so that is still to do.'
  const turn = async () => {
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 })) {
      // the pet eats
    }
    await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await new Promise(done => setTimeout(done, 40))      // the remark is not waited for by the turn, so give it a moment
  }
  const band = () => $.ui.mount({ plugin: 'vramagotchi', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as never)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await turn()
  expect(asked).toEqual([])

  const turnedOn = String(((await $.command.run({ command: 'pet', args: 'talk on' } as never)) as { text?: string }).text)
  expect(asked.length).toBe(1)      // its personality is written the first time it is allowed to talk
  expect(asked[0]?.system).toContain('personality')
  expect(turnedOn).toContain('personality: Nobody ran the tests')
  expect((kept.pet as Save).quirk).toBe('Nobody ran the tests, did they?')
  const remarks = () => asked.filter(one => one.system?.includes('ONE short remark'))

  await clock.advance(10_000)
  await turn()
  expect(remarks().length).toBe(1)
  expect(remarks()[0]?.prompt).toContain('did not run the test suite')
  expect(remarks()[0]?.system).toContain('Your own personality: Nobody ran the tests')
  expect(await (await band()).find({ type: 'Text', text: /Nobody ran the tests, did they\?/ })).toBeTruthy()

  await clock.advance(30_000)
  await turn()
  expect(remarks().length).toBe(1)

  await clock.advance(4 * 60_000)
  await turn()
  expect(remarks().length).toBe(2)
  expect(remarks()[1]?.prompt).toContain('You said these recently')      // so it does not tell the same joke twice

  // Its name in a prompt gets an answer at once, however lately it spoke.
  await clock.advance(5_000)
  await $.prompt.submit({ text: `hey ${(kept.pet as Save).name}, what do you think of this?` } as never)
  await turn()
  expect(remarks().length).toBe(3)
  expect(remarks()[2]?.prompt).toContain('spoke to you by name')
  await $.prompt.submit({ text: 'carry on' } as never)
  await turn()
  expect(remarks().length).toBe(3)

  // A failed test brings it out sooner than the usual three minutes, and it is told why.
  await clock.advance(50_000)
  await $.turn.start({ turnId: 't2' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' } as never)
  await turn()
  expect(remarks().length).toBe(4)
  expect(remarks()[3]?.prompt).toContain('Tests failed during this turn')

  await $.command.run({ command: 'pet', args: 'talk off' } as never)
  await clock.advance(4 * 60_000)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'npm test' } as never)
  await $.prompt.submit({ text: `${(kept.pet as Save).name}?` } as never)
  await turn()
  expect(remarks().length).toBe(4)
})

test('the memory game shows shapes, takes them back in order, and keeps the best run', async ($, on) => {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const kept: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000 }, rateLimits: [] } }) as never)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], usage: { input_tokens: 10, output_tokens: 500 } } as never
  })
  on('session.start', (_, e) => e as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 })) {
    // the pet eats, and hatches
  }
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const MARKS = ['▲', '●', '■', '◆']
  const band = () => $.ui.mount(BAND)
  const lifetime = (kept.pet as Save).lifetime

  /** Watches one showing to its end and returns the shapes in the order they came up. */
  const watch = async (): Promise<number[]> => {
    const seen: number[] = []

    for (let beat = 0; beat < 60; beat++) {
      const ui = await band()

      if (await ui.find({ type: 'Text', text: /your turn/ })) {
        return seen
      }

      const shown = await ui.find({ type: 'Text', text: /^[▲●■◆]$/ })

      if (shown) {
        seen.push(MARKS.indexOf(String((shown as { text?: string }).text)))
      }

      await clock.advance(600)
    }

    throw new Error('the showing never ended')
  }

  expect(String(((await $.command.run({ command: 'pet', args: 'play memory' } as never)) as { text?: string }).text)).toContain('Memory game')
  expect(await (await band()).find({ type: 'Button', text: /▲/ })).toBeFalsy()      // no pressing while it is still showing

  for (const round of [1, 2, 3]) {
    const order = await watch()
    expect(order.length).toBe(round)

    for (const one of order) {
      await (await band()).press({ key: `shape${one}` } as never)
    }
  }

  const order = await watch()
  expect(order.length).toBe(4)
  await (await band()).press({ key: `shape${((order[0] ?? 0) + 1) % 4}` } as never)      // a wrong one
  expect(await (await band()).find({ type: 'Text', text: /remembered 3 in a row\. Best: 3\./ })).toBeTruthy()
  expect((kept.pet as Save).bestMemory).toBe(3)
  expect((kept.pet as Save).lifetime).toBe(lifetime)      // playing feeds nothing

  await (await band()).press({ key: 'quit' } as never)
  expect(await (await band()).find({ type: 'Text', text: /baby \w+ · idle/ })).toBeTruthy()

  // The catch game: tokens fall by themselves, and three on the ground end it.
  expect(String(((await $.command.run({ command: 'pet', args: 'play' } as never)) as { text?: string }).text)).toContain('three games')
  await $.command.run({ command: 'pet', args: 'play catch' } as never)
  expect(await (await band()).find({ type: 'Text', text: /catch game$/ })).toBeTruthy()
  expect(await (await band()).find({ type: 'Raster' })).toBeTruthy()
  await (await band()).press({ key: 'left' } as never)
  await (await band()).press({ key: 'left' } as never)
  await (await band()).press({ key: 'left' } as never)      // against the wall: most tokens land beside it

  for (let beat = 0; beat < 400 && !(await (await band()).find({ type: 'Text', text: /catch game · over/ })); beat++) {
    await clock.advance(250)
  }

  const over = await band()
  expect(await over.find({ type: 'Text', text: /catch game · over/ })).toBeTruthy()
  expect(await over.find({ type: 'Text', text: /missed ●●●/ })).toBeTruthy()
  expect(await over.find({ type: 'Button', text: /◀/ })).toBeFalsy()
  expect((kept.pet as Save).bestCatch).toBeGreaterThanOrEqual(0)
  expect((kept.pet as Save).lifetime).toBe(lifetime)
  expect(await (await $.ui.mount({ ...(BAND as object), surface: 'desktop' } as never)).find({ type: 'Svg' })).toBeTruthy()
  await over.press({ key: 'quit' } as never)
  expect(await (await band()).find({ type: 'Text', text: /baby \w+ · idle/ })).toBeTruthy()
})

test('blackjack against the pet deals, hits, stands and ends every hand', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  const kept: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: kept[e.key] }) as never)
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined } as never
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 50_000, window: 200_000 }, rateLimits: [] } }) as never)
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], usage: { input_tokens: 10, output_tokens: 500 } } as never
  })
  on('session.start', (_, e) => e as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'test', messageCount: 1 })) {
    // the pet eats, and hatches
  }
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const band = () => $.ui.mount(BAND)
  const lifetime = (kept.pet as Save).lifetime

  // Las Vegas rules, a sealed shoe, play chips. A dozen hands, and every chip has to add up.
  const text = async (pattern: RegExp): Promise<string> => String(((await (await band()).find({ type: 'Text', text: pattern })) as { text?: string } | undefined)?.text ?? '')
  const chipsNow = async (): Promise<number> => Number(/(\d+) chips/.exec(await text(/ chips · bet /))?.[1])
  const NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
  const SUITS = ['♠', '♥', '♦', '♣']
  const cardOf = (name: string): number => NAMES.indexOf(name.slice(0, -1)) + 13 * SUITS.indexOf(name.slice(-1))

  const intro = String(((await $.command.run({ command: 'pet', args: 'play blackjack' } as never)) as { text?: string }).text)
  expect(intro).toContain('Las Vegas rules')
  const seal = /seal ([a-f0-9]{12})/.exec(intro)?.[1] ?? ''
  expect(seal.length).toBe(12)
  const first = [...(await text(/^You: /)).matchAll(/(10|[AJQK2-9])[♠♥♦♣]/g)].map(found => cardOf(found[0]))
  const up = cardOf(/: ((?:10|[AJQK2-9])[♠♥♦♣])/.exec(await text(/\?\?$|\(\d+\)$/))?.[1] ?? '')
  let chips = 1000
  let seen = { win: 0, lose: 0, push: 0 }

  for (let hand = 0; hand < 12; hand++) {
    const bet = Number(/bet (\d+)/.exec(await text(/ chips · bet /))?.[1])
    expect(await text(/shoe sealed/)).toContain(seal)      // one shoe, one seal, the whole way through

    for (let card = 0; card < 16 && (await (await band()).find({ type: 'Button', text: /Hit/ })); card++) {
      const mine = Number(/▸[^|]*\((\d+)\)/.exec(await text(/^You: /))?.[1] ?? /\((\d+)\)/.exec(await text(/^You: /))?.[1])
      expect(mine).toBeLessThan(21)
      expect(await text(/\?\?$/)).toBeTruthy()      // the pet's second card stays face down
      const ui = await band()
      const key = (await ui.find({ type: 'Button', text: /Split/ })) ? 'split' : mine === 11 && (await ui.find({ type: 'Button', text: /Double/ })) ? 'double' : mine < 17 ? 'hit' : 'stand'
      await ui.press({ key } as never)
    }

    const said = await text(/You win \d+\.|You lose \d+\.|A push/)
    const net = /You win (\d+)/.test(said) ? Number(/You win (\d+)/.exec(said)?.[1]) : /You lose (\d+)/.test(said) ? -Number(/You lose (\d+)/.exec(said)?.[1]) : 0
    seen = { win: seen.win + (net > 0 ? 1 : 0), lose: seen.lose + (net < 0 ? 1 : 0), push: seen.push + (net === 0 ? 1 : 0) }
    expect(said).toBeTruthy()
    expect(Math.abs(net) % 5).toBe(0)
    expect(Math.abs(net)).toBeLessThanOrEqual(bet * 4)
    chips += net
    expect(await chipsNow()).toBe(chips)      // what the table says you have is what the hands add up to
    const dealer = await text(new RegExp(`^${(kept.pet as Save).name}: `))
    expect(dealer).not.toContain('??')

    if (!/You went over|blackjack|Blackjack/.test(said)) {
      expect(Number(/\((\d+)\)$/.exec(dealer)?.[1])).toBeGreaterThanOrEqual(17)      // the dealer draws to 17
    }

    await (await band()).press({ key: 'deal10' } as never)
  }

  expect(seen.win + seen.lose + seen.push).toBe(12)
  expect((kept.pet as Save).lifetime).toBe(lifetime)

  // The shoe is put aside and opened: its order must hash to the seal that was on screen, and start with the cards that were dealt.
  await $.command.run({ command: 'pet', args: 'play shuffle' } as never)
  const opened = String(((await $.command.run({ command: 'pet', args: 'play proof' } as never)) as { text?: string }).text)
  const salt = /salt\s+([a-f0-9]{32})/.exec(opened)?.[1] ?? ''
  const order = /^[\d,]{600,}$/m.exec(opened)?.[0] ?? ''
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${order}`))), byte => byte.toString(16).padStart(2, '0')).join('')
  expect(hash.slice(0, 12)).toBe(seal)
  expect(opened).toContain(`seal   ${hash}`)
  const cards = order.split(',').map(Number)
  expect(cards.length).toBe(312)
  expect([...cards].sort((a, b) => a - b)).toEqual(Array.from({ length: 312 }, (_, i) => Math.floor(i / 6)))      // six of every card, no more, no fewer
  expect([cards[0], cards[2]]).toEqual(first.slice(0, 2))      // dealt the Vegas way: you, the dealer, you, the dealer
  expect(cards[1]).toBe(up)
})
