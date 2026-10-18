// Punto de entrada provisional de la fase 6: escena a la hora actual con la marea predicha.
import './style.css';
import { crearEscena } from './scene/escena';
import { crearMotor } from './tide/motor';
import constantes from './tide/constantes.json';

const motor = crearMotor({ z0: constantes.z0Ch, constituyentes: constantes.constituyentes });
const lienzo = document.querySelector<HTMLCanvasElement>('#escena')!;
const params = new URLSearchParams(location.search);
const t = params.has('t') ? Date.parse(params.get('t')!) : Date.now();
const escena = await crearEscena(lienzo);
const max6h = Math.max(...motor.serie(t - 6 * 3_600_000, t, 600_000).map((p) => p.h));
escena.actualizar({ t, nivel: motor.altura(t), nivelMax6h: max6h });
