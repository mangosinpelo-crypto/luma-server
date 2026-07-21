import { Router } from 'express';

const router = Router();

// Voice mapping per archetype in Spanish
const ARCHETYPE_VOICES = {
  pareja: { name: 'Dalia (México)', lang: 'es-MX', voiceURI: 'es-MX-DaliaNeural', pitch: 1.05, rate: 1.0 },
  amigaToxica: { name: 'Elvira (España)', lang: 'es-ES', voiceURI: 'es-ES-ElviraNeural', pitch: 1.15, rate: 1.1 },
  rival: { name: 'Salomé (Colombia)', lang: 'es-CO', voiceURI: 'es-CO-SalomeNeural', pitch: 0.95, rate: 1.05 },
  ex: { name: 'Paloma (España)', lang: 'es-ES', voiceURI: 'es-ES-PalomaNeural', pitch: 0.9, rate: 0.92 },
  mejorAmigo: { name: 'Alonso (EE.UU.)', lang: 'es-US', voiceURI: 'es-US-AlonsoNeural', pitch: 1.0, rate: 1.05 }
};

/**
 * GET /api/audio/voices
 * Returns voice configurations for characters.
 */
router.get('/voices', (req, res) => {
  res.json(ARCHETYPE_VOICES);
});

export default router;
