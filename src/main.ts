// Punto de entrada: arranca la interfaz (funciona aunque falle el 3D) y después carga la escena,
// que va en su propio paquete (three.js) para que el panel aparezca antes.
import './style.css';
import { iniciarInterfaz } from './ui/app';

const interfaz = iniciarInterfaz();
const aviso = document.getElementById('aviso-escena')!;

import('./scene/escena')
  .then(({ crearEscena }) => crearEscena(document.querySelector<HTMLCanvasElement>('#escena')!))
  .then((escena) => {
    interfaz.conectarEscena(escena);
    aviso.hidden = true;
  })
  .catch((e) => {
    console.error(e);
    aviso.textContent = 'No se pudo mostrar la escena 3D en este navegador. Los datos de marea siguen disponibles.';
  });
