import express from 'express';

import { searchQuery } from '../controllers/query.controllers.js';

const router = express.Router();

router.route('/query').post(searchQuery);

export default router;
