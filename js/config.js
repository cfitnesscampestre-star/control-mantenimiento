'use strict';
/* =====================================================================
   config.js — conexión de Control Mantenimiento con su base de datos.
   Proyecto de Firebase: registro-mantenimiento-9854c (Realtime Database).
   ===================================================================== */
const FIREBASE_MANT = {
  apiKey:      'AIzaSyB_XzEY0fLuv9pNSAtf0tGSEZIDi2JG1SM',
  authDomain:  'registro-mantenimiento-9854c.firebaseapp.com',
  databaseURL: 'https://registro-mantenimiento-9854c-default-rtdb.firebaseio.com',
  projectId:   'registro-mantenimiento-9854c',
  appId:       '1:712713568770:web:a0e514012ecd34e9b8dd1b'
};

/* Carrusel de reportes: segundos que se muestra cada reporte antes de pasar al siguiente, y segundos que espera
   después de que alguien lo toca o lo desliza antes de volver a avanzar solo. */
const CARRUSEL_SEGUNDOS = 6;
const CARRUSEL_ESPERA   = 15;

/* Acceso: cada técnico entra con su usuario y su PIN (Firebase Authentication, correo y contraseña).
   El usuario "tecnico" es en realidad tecnico@DOMINIO_ACCESO; el PIN es la contraseña (mínimo 6 caracteres).
   Si pones REQUIERE_ACCESO = false, la app abre sin pedir acceso. */
const REQUIERE_ACCESO = true;
const DOMINIO_ACCESO  = 'mantenimiento.club';

/* Foto del "después" al resolver: false = avisa pero deja resolver sin foto; true = no deja resolver sin ella. */
const FOTO_DESPUES_OBLIGATORIA = false;
