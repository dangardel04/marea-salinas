// Punto de entrada: arranca la interfaz (funciona aunque falle el 3D) y después la escena.
import './style.css';
import { iniciarInterfaz } from './ui/app';
import { crearEscena } from './scene/escena';

const interfaz = iniciarInterfaz();
const aviso = document.getElementById('aviso-escena')!;

crearEscena(document.querySelector<HTMLCanvasElement>('#escena')!)
  .then((escena) => {
    interfaz.conectarEscena(escena);
    aviso.hidden = true;
  })
  .catch((e) => {
    console.error(e);
    aviso.textContent = 'No se pudo mostrar la escena 3D en este navegador. Los datos de marea siguen disponibles.';
  });
