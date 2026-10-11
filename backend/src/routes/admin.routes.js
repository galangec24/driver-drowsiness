const { Router } = require('express');
const ctrl = require('../controllers/admin.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/admin.middleware');

const router = Router();
router.use(requireAuth, asyncHandler(requireAdmin));

router.get('/overview', asyncHandler(ctrl.overview));
router.get('/parents', asyncHandler(ctrl.parents));
router.get('/datasets', asyncHandler(ctrl.datasets));
router.post('/recordings', validate(ctrl.uploadSchema), asyncHandler(ctrl.uploadRecording));
router.get('/jobs', asyncHandler(ctrl.listJobs));
router.post('/jobs', asyncHandler(ctrl.createJob));
router.get('/jobs/:id', asyncHandler(ctrl.getJob));
router.post('/jobs/:id/cancel', asyncHandler(ctrl.cancelJob));
router.get('/models', asyncHandler(ctrl.listModels));
router.get('/models/:id', asyncHandler(ctrl.getModel));
router.post('/models/:id/promote', asyncHandler(ctrl.promoteModel));
router.post('/models/reset/:kind', asyncHandler(ctrl.resetModel));

module.exports = router;
