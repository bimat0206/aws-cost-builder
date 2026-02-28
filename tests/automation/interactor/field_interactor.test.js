import { describe, it, expect, vi } from 'vitest';
import { verifyFieldValue } from '../../../automation/interactor/field_interactor.js';

describe('verifyFieldValue', () => {
  // Helper to create a mock element that executes the evaluate callback
  // with a provided mock DOM node.
  const createMockElement = (mockNode) => {
    return {
      evaluate: vi.fn().mockImplementation(async (callback) => {
        return callback(mockNode);
      })
    };
  };

  describe('TOGGLE field type', () => {
    it('should correctly verify an input element with checked property (expected true)', async () => {
      const mockElement = createMockElement({
        tagName: 'INPUT',
        checked: true,
      });
      const result = await verifyFieldValue(mockElement, 'TOGGLE', 'true');
      expect(result).toBe(true);
    });

    it('should correctly verify an input element with checked property (expected false)', async () => {
      const mockElement = createMockElement({
        tagName: 'INPUT',
        checked: false,
      });
      const result = await verifyFieldValue(mockElement, 'TOGGLE', 'false');
      expect(result).toBe(true);
    });

    it('should correctly verify an input element with expected value "1"', async () => {
      const mockElement = createMockElement({
        tagName: 'INPUT',
        checked: true,
      });
      const result = await verifyFieldValue(mockElement, 'TOGGLE', '1');
      expect(result).toBe(true);
    });

    it('should correctly verify a non-input element using aria-checked (expected true)', async () => {
      const mockElement = createMockElement({
        tagName: 'DIV',
        getAttribute: (attr) => attr === 'aria-checked' ? 'true' : null,
      });
      const result = await verifyFieldValue(mockElement, 'TOGGLE', 'true');
      expect(result).toBe(true);
    });

    it('should fail verification if toggle state does not match', async () => {
      const mockElement = createMockElement({
        tagName: 'INPUT',
        checked: true,
      });
      const result = await verifyFieldValue(mockElement, 'TOGGLE', 'false');
      expect(result).toBe(false);
    });
  });

  describe('RADIO field type', () => {
    it('should return true if input element is checked', async () => {
      const mockElement = createMockElement({
        tagName: 'INPUT',
        checked: true,
      });
      // expectedValue is ignored for RADIO
      const result = await verifyFieldValue(mockElement, 'RADIO', 'anything');
      expect(result).toBe(true);
    });

    it('should return false if input element is not checked', async () => {
      const mockElement = createMockElement({
        tagName: 'INPUT',
        checked: false,
      });
      const result = await verifyFieldValue(mockElement, 'RADIO', 'anything');
      expect(result).toBe(false);
    });

    it('should return true if non-input element has aria-checked="true"', async () => {
      const mockElement = createMockElement({
        tagName: 'DIV',
        getAttribute: (attr) => attr === 'aria-checked' ? 'true' : null,
      });
      const result = await verifyFieldValue(mockElement, 'RADIO', 'anything');
      expect(result).toBe(true);
    });
  });

  describe('SELECT field type', () => {
    it('should return true if select element value includes expected value', async () => {
      const mockElement = createMockElement({
        tagName: 'SELECT',
        value: 'Option 1 Selected',
      });
      const result = await verifyFieldValue(mockElement, 'SELECT', 'option 1');
      expect(result).toBe(true);
    });

    it('should return false if select element value does not include expected value', async () => {
      const mockElement = createMockElement({
        tagName: 'SELECT',
        value: 'Option 2 Selected',
      });
      const result = await verifyFieldValue(mockElement, 'SELECT', 'option 1');
      expect(result).toBe(false);
    });

    it('should handle non-select elements using data-value', async () => {
      const mockElement = createMockElement({
        tagName: 'DIV',
        getAttribute: (attr) => attr === 'data-value' ? 'SomeValue' : null,
      });
      const result = await verifyFieldValue(mockElement, 'SELECT', 'somevalue');
      expect(result).toBe(true);
    });

    it('should handle non-select elements using textContent fallback', async () => {
      const mockElement = createMockElement({
        tagName: 'DIV',
        getAttribute: () => null,
        textContent: 'Display Text',
      });
      const result = await verifyFieldValue(mockElement, 'SELECT', 'display');
      expect(result).toBe(true);
    });
  });

  describe('NUMBER and TEXT field types', () => {
    it('should return true if input value matches expected value exactly for TEXT', async () => {
      const mockElement = createMockElement({
        value: 'exact string',
      });
      const result = await verifyFieldValue(mockElement, 'TEXT', 'exact string');
      expect(result).toBe(true);
    });

    it('should return false if input value does not match exactly for TEXT', async () => {
      const mockElement = createMockElement({
        value: 'exact string',
      });
      const result = await verifyFieldValue(mockElement, 'TEXT', 'Exact String'); // Case sensitive
      expect(result).toBe(false);
    });

    it('should return true if input value matches expected value exactly for NUMBER', async () => {
      const mockElement = createMockElement({
        value: '42',
      });
      const result = await verifyFieldValue(mockElement, 'NUMBER', 42); // will be stringified
      expect(result).toBe(true);
    });

    it('should default to TEXT type if fieldType is null/undefined', async () => {
      const mockElement = createMockElement({
        value: 'default test',
      });
      const result = await verifyFieldValue(mockElement, null, 'default test');
      expect(result).toBe(true);
    });
  });

  describe('COMBOBOX and unknown types', () => {
    it('should return true for COMBOBOX type', async () => {
      const mockElement = {
        evaluate: vi.fn()
      };
      const result = await verifyFieldValue(mockElement, 'COMBOBOX', 'any');
      expect(result).toBe(true);
      expect(mockElement.evaluate).not.toHaveBeenCalled();
    });

    it('should return true for unknown types', async () => {
      const mockElement = {
        evaluate: vi.fn()
      };
      const result = await verifyFieldValue(mockElement, 'UNKNOWN_TYPE', 'any');
      expect(result).toBe(true);
      expect(mockElement.evaluate).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should return false if evaluate throws an error', async () => {
      const mockElement = {
        evaluate: vi.fn().mockRejectedValue(new Error('Playwright evaluation failed'))
      };
      const result = await verifyFieldValue(mockElement, 'TEXT', 'value');
      expect(result).toBe(false);
    });
  });
});
