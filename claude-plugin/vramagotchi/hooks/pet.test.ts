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
