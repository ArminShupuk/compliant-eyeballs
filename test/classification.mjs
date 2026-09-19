import test from 'node:test';

// Keep the requirement or API reference beside each test definition. The
// static check also verifies that every cited RFC section appears in PROFILE.
export function rfc(section, name, ...rest) {
  return test(`[RFC 8305 §${section}] ${name}`, ...rest);
}

export function contract(reference, name, ...rest) {
  return test(`[Contract: ${reference}] ${name}`, ...rest);
}

contract.skip = (reference, name, ...rest) => test.skip(`[Contract: ${reference}] ${name}`, ...rest);
