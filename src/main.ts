import './style.css';
import { mountCyberPetApp } from './ui/appController';

const rootEl = document.getElementById('app');
if (rootEl) {
  void mountCyberPetApp(rootEl);
}
