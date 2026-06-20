import { describe, it, expect } from 'vitest';
import { classifyRegion } from './regions';

describe('classifyRegion', () => {
  describe('North Coast', () => {
    it('classifies Jedediah Smith Redwoods (41.78, -124.10)', () => {
      expect(classifyRegion(41.78, -124.10)).toBe('north-coast');
    });
    it('classifies Humboldt Redwoods (40.34, -124.00)', () => {
      expect(classifyRegion(40.34, -124.00)).toBe('north-coast');
    });
    it('classifies MacKerricher (39.50, -123.79)', () => {
      expect(classifyRegion(39.50, -123.79)).toBe('north-coast');
    });
  });

  describe('Bay Area', () => {
    it('classifies Salt Point (38.58, -123.31)', () => {
      expect(classifyRegion(38.58, -123.31)).toBe('bay-area');
    });
    it('classifies Samuel P. Taylor (38.02, -122.73)', () => {
      expect(classifyRegion(38.02, -122.73)).toBe('bay-area');
    });
    it('classifies Russian Gulch (39.33, -123.76)', () => {
      expect(classifyRegion(39.33, -123.76)).toBe('bay-area');
    });
  });

  describe('Sierra', () => {
    it('classifies D.L. Bliss (38.99, -120.10)', () => {
      expect(classifyRegion(38.99, -120.10)).toBe('sierra');
    });
    it('classifies Donner Memorial (39.29, -120.29)', () => {
      expect(classifyRegion(39.29, -120.29)).toBe('sierra');
    });
    it('classifies Plumas-Eureka (39.76, -120.70)', () => {
      expect(classifyRegion(39.76, -120.70)).toBe('sierra');
    });
  });

  describe('Central Coast', () => {
    it('classifies Pfeiffer Big Sur (36.25, -121.78)', () => {
      expect(classifyRegion(36.25, -121.78)).toBe('central-coast');
    });
    it('classifies Morro Bay (35.34, -120.83)', () => {
      expect(classifyRegion(35.34, -120.83)).toBe('central-coast');
    });
    it('classifies Gaviota (34.49, -120.24)', () => {
      expect(classifyRegion(34.49, -120.24)).toBe('central-coast');
    });
  });

  describe('SoCal', () => {
    it('classifies Malibu Creek (34.08, -118.75)', () => {
      expect(classifyRegion(34.08, -118.75)).toBe('socal');
    });
    it('classifies Anza-Borrego (33.10, -116.30)', () => {
      expect(classifyRegion(33.10, -116.30)).toBe('socal');
    });
    it('classifies Fort Tejon (34.87, -118.90)', () => {
      expect(classifyRegion(34.87, -118.90)).toBe('socal');
    });
  });
});
