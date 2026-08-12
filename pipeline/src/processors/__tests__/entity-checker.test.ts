import { describe, it, expect } from 'vitest';
import { extractEntities, checkEntityPreservation } from '../entity-checker.js';

describe('extractEntities', () => {
  it('extracts EIP references', () => {
    expect(extractEntities('EIP-7702 introduces account abstraction')).toEqual(['EIP-7702']);
  });

  it('extracts multiple ERC references', () => {
    const result = extractEntities('ERC-20 and ERC-721 are token standards');
    expect(result).toEqual(expect.arrayContaining(['ERC-20', 'ERC-721']));
    expect(result).toHaveLength(2);
  });

  it('extracts percentages', () => {
    const result = extractEntities('up 5.2% from 3%');
    expect(result).toEqual(expect.arrayContaining(['5.2%', '3%']));
    expect(result).toHaveLength(2);
  });

  it('extracts dollar amounts', () => {
    expect(extractEntities('$8.7M in TVL')).toEqual(['$8.7M']);
  });

  it('extracts version numbers', () => {
    expect(extractEntities('v5.4.0 released')).toEqual(['v5.4.0']);
  });

  it('extracts mixed entities from one text', () => {
    const text = 'EIP-4844 reduces fees by 10% with v2.1.0, saving $5M for ERC-20 transfers';
    const result = extractEntities(text);
    expect(result).toEqual(expect.arrayContaining(['EIP-4844', '10%', 'v2.1.0', '$5M', 'ERC-20']));
  });

  it('deduplicates repeated entities', () => {
    const result = extractEntities('EIP-7702 is great. EIP-7702 is important.');
    expect(result).toEqual(['EIP-7702']);
  });

  it('returns empty array when no entities found', () => {
    expect(extractEntities('Just some plain text with no entities')).toEqual([]);
  });

  it('extracts entities from text with HTML tags', () => {
    const result = extractEntities('<p>EIP-4844 is great</p>');
    expect(result).toEqual(expect.arrayContaining(['EIP-4844']));
  });

  it('deduplicates when same entity appears three times', () => {
    const result = extractEntities('EIP-4844 EIP-4844 EIP-4844');
    expect(result).toEqual(['EIP-4844']);
    expect(result).toHaveLength(1);
  });
});

describe('checkEntityPreservation', () => {
  it('passes when source has no entities', () => {
    const result = checkEntityPreservation('No entities here', 'Summary text');
    expect(result).toEqual({ passed: true, missingEntities: [], totalEntities: 0, preservationRate: 1 });
  });

  it('passes when all entities are preserved', () => {
    const source = 'EIP-7702 reduces fees by 10%';
    const summary = 'EIP-7702 reduces fees by 10% via blobs';
    const result = checkEntityPreservation(source, summary);
    expect(result.passed).toBe(true);
    expect(result.missingEntities).toEqual([]);
  });

  it('fails when a critical EIP entity is missing', () => {
    const source = 'EIP-7702 and EIP-4844 improve scaling by 50%';
    // Summary has 50% but missing EIP-7702
    const summary = 'EIP-4844 improves scaling by 50%';
    const result = checkEntityPreservation(source, summary);
    expect(result.passed).toBe(false);
    expect(result.missingEntities).toContain('EIP-7702');
  });

  it('fails when a critical ERC entity is missing', () => {
    const source = 'ERC-20 and ERC-721 token standards updated with v2.0.0';
    const summary = 'Token standards updated with v2.0.0 for ERC-20';
    const result = checkEntityPreservation(source, summary);
    expect(result.passed).toBe(false);
    expect(result.missingEntities).toContain('ERC-721');
  });

  it('passes when non-critical entity is missing but >= 80% preserved', () => {
    // 5 entities total: EIP-4844, 10%, 20%, 30%, 50%
    // Missing 50% (1 out of 5 = 80% preserved), no critical entities missing
    const source = 'EIP-4844 shows 10% and 20% and 30% and 50% improvements';
    const summary = 'EIP-4844 shows 10% and 20% and 30% improvements';
    const result = checkEntityPreservation(source, summary);
    expect(result.passed).toBe(true);
    expect(result.missingEntities).toEqual(['50%']);
  });

  it('fails when preservation rate is below 80%', () => {
    // 5 entities: 10%, 20%, 30%, 40%, 50% — missing 2 = 60% preserved
    const source = 'Stats: 10% 20% 30% 40% 50%';
    const summary = 'Stats: 10% 20% 30%';
    const result = checkEntityPreservation(source, summary);
    expect(result.passed).toBe(false);
  });

  it('returns the list of missing entities', () => {
    const source = 'EIP-1559 changed 15% of fees and saved $2M';
    const summary = 'EIP-1559 changed fees';
    const result = checkEntityPreservation(source, summary);
    expect(result.missingEntities).toEqual(expect.arrayContaining(['15%', '$2M']));
  });

  it('returns passed: true with empty missing list when both source and summary are empty', () => {
    const result = checkEntityPreservation('', '');
    expect(result).toEqual({ passed: true, missingEntities: [], totalEntities: 0, preservationRate: 1 });
  });
});
