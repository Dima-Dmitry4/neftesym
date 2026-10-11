// Точка входа. Инициализирует DOM, монтирует App.
// Реальный UI собирается в Phase 2; пока что — заглушка.

import './styles.css';
import { mountApp } from './app/App.ts';

const root = document.getElementById('app');
if (!root) {
  throw new Error('#app root not found');
}
mountApp(root);
