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

  await $.command.run({ command: 'pet', args: 'talk on' } as never)
  await clock.advance(10_000)
  await turn()
  expect(asked.length).toBe(1)
  expect(asked[0]?.prompt).toContain('did not run the test suite')
  expect(await (await band()).find({ type: 'Text', text: /Nobody ran the tests, did they\?/ })).toBeTruthy()

  await clock.advance(30_000)
  await turn()
  expect(asked.length).toBe(1)

  await clock.advance(4 * 60_000)
  await turn()
  expect(asked.length).toBe(2)

  await $.command.run({ command: 'pet', args: 'talk off' } as never)
  await clock.advance(4 * 60_000)
  await turn()
  expect(asked.length).toBe(2)
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
  expect(String(((await $.command.run({ command: 'pet', args: 'play' } as never)) as { text?: string }).text)).toContain('two games')
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
