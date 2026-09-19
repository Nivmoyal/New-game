import './styles.css';
import { Game } from './game';

const root = document.getElementById('app');
if (!root) throw new Error('חסר אלמנט #app');

new Game(root);

// טעינה מהירה של גופן אמוג'י — משפר את המראה בטעינה הראשונה
document.fonts?.ready.then(() => {
  document.body.classList.add('fonts-ready');
});
