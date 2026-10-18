// Punto de entrada provisional (fase 1). La escena y la interfaz llegan en las fases 6 y 7.
import { PLAYA } from './config';

document.querySelector<HTMLDivElement>('#app')!.textContent =
  `${PLAYA.nombre}: ${PLAYA.lat}, ${PLAYA.lon}`;
