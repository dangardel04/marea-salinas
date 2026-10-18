// Programa el siguiente cuadro de animación. En desarrollo, con ?temporizador en la URL, usa un
// temporizador en lugar de requestAnimationFrame (útil para revisar la escena en un navegador
// en segundo plano, que congela requestAnimationFrame).
const conTemporizador = import.meta.env.DEV && typeof location !== 'undefined' && location.search.includes('temporizador');

export function siguienteCuadro(cb: (t: number) => void): void {
  if (conTemporizador) setTimeout(() => cb(performance.now()), 33);
  else requestAnimationFrame(cb);
}
