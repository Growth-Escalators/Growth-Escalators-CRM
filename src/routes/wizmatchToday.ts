import { Router } from 'express';

const router = Router();

router.use((_req, res) => {
  res.status(410).json({
    error: 'retired',
    message: 'WizMatch decision-workbench tooling has been retired.',
  });
});

export default router;
