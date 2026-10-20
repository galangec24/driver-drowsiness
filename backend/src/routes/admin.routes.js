const { Router } = require('express');
const ctrl = require('../controllers/admin.controller');
const feedback = require('../controllers/feedback.controller');
const validate = require('../utils/validate');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth.middleware');
const { requireAdmin } = require('../middleware/admin.middleware');

const router = Router();
router.use(requireAuth, asyncHandler(requireAdmin));

router.get('/overview', asyncHandler(ctrl.overview));
router.get('/parents', asyncHandler(ctrl.parents));
router.get('/feedback', asyncHandler(feedback.adminList));
router.get('/ratings', asyncHandler(require('../controllers/ratings.controller').adminList));

// Surveys: create in the app or import from Word / PDF / Excel, publish, results with charts, Excel export
const surveys = require('../controllers/surveys.controller');
router.get('/surveys', asyncHandler(surveys.adminList));
router.post('/surveys', validate(surveys.surveySchema), asyncHandler(surveys.create));
router.post('/surveys/import', validate(surveys.importSchema), asyncHandler(surveys.importFile));
router.get('/surveys/:id', asyncHandler(surveys.adminGet));
router.patch('/surveys/:id', validate(surveys.updateSchema), asyncHandler(surveys.update));
router.post('/surveys/:id/publish', asyncHandler(surveys.publish));
router.post('/surveys/:id/close', asyncHandler(surveys.close));
router.delete('/surveys/:id', asyncHandler(surveys.remove));
router.get('/surveys/:id/results', asyncHandler(surveys.results));
router.get('/surveys/:id/export.xlsx', asyncHandler(surveys.exportXlsx));
router.patch('/feedback/:id', validate(feedback.updateSchema), asyncHandler(feedback.adminUpdate));
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
