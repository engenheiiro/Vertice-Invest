/**
 * (I13) Endpoints admin para ler/editar os tunables operacionais sem deploy.
 */
import { describeTunables, updateTunables } from '../services/configService.js';

export const getTunablesHandler = async (req, res, next) => {
  try {
    res.json({ tunables: await describeTunables() });
  } catch (e) { next(e); }
};

export const updateTunablesHandler = async (req, res, next) => {
  try {
    const updated = await updateTunables(req.body || {});
    res.json({ message: 'Configurações atualizadas.', tunables: updated });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ message: e.message });
    next(e);
  }
};
