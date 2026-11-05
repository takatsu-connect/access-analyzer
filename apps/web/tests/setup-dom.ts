import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest の globals を使わないので、描画した部品の後片付けを明示する。
afterEach(() => {
  cleanup();
});
