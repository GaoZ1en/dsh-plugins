// Pure fixture checks extracted verbatim from the local live-probe, so the
// public regression suite does not import or ship the private runtime probe.
// Formatting-only normalization for this one explicit fixture, not algebraic
// simplification. Check the entire polynomial, including the negative sign.
export function hasFixturePolynomial(text) {
  const normalized = text.replace(/\\lambda\b|λ/g, 'lambda')
    .replace(/\\(?:cdot|times)\b/g, '*').replace(/\^\{2\}|²|\*\*2/g, '^2')
    .replace(/[−–]/g, '-').replace(/[\s*]/g, '');
  return /F\(lambda\)=3lambda\^2-2lambda\+7(?=$|[,，。;；`$]|\\(?:qquad|quad|\]|\)))/.test(normalized);
}
export function hasObsoletePayload(messages, probes) {
  return messages.some(message => (message.content ?? []).some(block => {
    const value = block.type === 'text' ? block.text : block.type === 'tool-call' ? block.arguments : undefined;
    return typeof value === 'string' && probes.some(probe => typeof probe === 'string' && probe.length > 0 && value.includes(probe));
  }));
}
export function oneSuccessfulOrdinary(requests, occupied) {
  const successes = requests.filter(request => request.finish?.kind === 'stop');
  return Number.isFinite(occupied) && occupied >= 0 && successes.length === 1 && successes[0].actualInputTokens === occupied && requests.every(request => request === successes[0] || request.finish?.kind === 'error');
}
