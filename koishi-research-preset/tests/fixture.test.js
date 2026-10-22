import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFixturePolynomial, hasObsoletePayload, oneSuccessfulOrdinary } from './fixture-helpers.js';

test('manual fixture recognizes equivalent text/TeX notation without weakening its signs', () => {
  for (const text of [
    'F(lambda)=3*lambda^2-2*lambda+7',
    String.raw`\[F(\lambda)=3*\lambda^2-2*\lambda+7,\qquad F(2)=15.\]`,
    String.raw`\(F(\lambda)=3\lambda^{2}-2\lambda+7\)`,
    'F(λ) = 3λ² − 2λ + 7。',
    'F(lambda)=3*lambda**2-2*lambda+7;',
  ]) assert.equal(hasFixturePolynomial(text), true, text);
  for (const text of [
    '3*lambda^2', 'F(lambda)=3*lambda^2+2*lambda+7',
    'F(lambda)=3*lambda^2-2*lambda+70', 'F(lambda)=3*lambda^2-2*lambda+7+lambda',
    'F(lambda)=4*lambda^2-2*lambda+7', 'F(lambda)=3*lambda^2-2*lambda+7.5',
  ]) assert.equal(hasFixturePolynomial(text), false, text);
});

test('payload eviction allows a short locator but detects bulk in text and tool arguments', () => {
  const marker = 'OLD_ARGUMENTS_123';
  const bulk = `${marker}\n${'old_parameter=0; '.repeat(900)}`;
  const probes = [bulk, 'old_parameter=0; '.repeat(32)];
  assert.equal(hasObsoletePayload([{ role: 'user', content: [{ type: 'text', text: `Archived ${marker}; read index for details.` }] }], probes), false);
  for (const block of [{ type: 'text', text: bulk }, { type: 'tool-call', arguments: JSON.stringify({ code: bulk }) }, { type: 'text', text: probes[1] }]) {
    assert.equal(hasObsoletePayload([{ role: 'assistant', content: [block] }], probes), true);
  }
});
test('actual-usage correlation permits bounded failed retries, never missing or duplicate success', () => {
  const success = { finish: { kind: 'stop' }, actualInputTokens: 123 };
  const error = { finish: { kind: 'error' }, actualInputTokens: 0 };
  assert.equal(oneSuccessfulOrdinary([success], 123), true);
  assert.equal(oneSuccessfulOrdinary([error, success], 123), true);
  for (const [requests, occupied] of [[[], 0], [[error], 0], [[success], null], [[success], 124], [[success, success], 123], [[{ finish: { kind: 'max-tokens' } }, success], 123]]) {
    assert.equal(oneSuccessfulOrdinary(requests, occupied), false);
  }
});
