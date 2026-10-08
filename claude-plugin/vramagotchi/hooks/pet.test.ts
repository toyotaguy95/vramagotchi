import { expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'

const BAND = { plugin: 'vramagotchi', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } } as never

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
  expect(await band.find({ type: 'Text', text: /baby · idle/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /context ███░░░░░░░ 25%/ })).toBeTruthy()

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [], toolResults: [] }] } as never)
  expect((kept.pet as Save).items).toContain('bandage')
  expect(await (await $.ui.mount(BAND)).find({ type: 'Text', text: /context ░░░░░░░░░░ 4%/ })).toBeTruthy()
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

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ rank: 1, score: 12_000, pets: [] }) } } as never
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
  expect(Object.keys(sent[0]?.body ?? {}).sort()).toEqual(['id', 'items', 'key', 'lifetime', 'name', 'shiny', 'wearing'])
  expect(sent[0]?.body.lifetime).toBe(12_000)

  await clock.advance(11 * 60_000)
  await turn()
  expect(sent.length).toBe(2)
  expect(sent[1]?.body.id).toBe(sent[0]?.body.id)
  const band = await $.ui.mount({ plugin: 'vramagotchi', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } } as never)
  expect(await band.find({ type: 'Text', text: /#1/ })).toBeTruthy()

  await $.command.run({ command: 'pet', args: 'board leave' } as never)
  expect(sent[2]?.method).toBe('DELETE')
  await clock.advance(11 * 60_000)
  await turn()
  expect(sent.length).toBe(3)
})
