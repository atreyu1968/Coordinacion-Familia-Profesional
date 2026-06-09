import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import invitationsRouter from "./invitations";
import usersRouter from "./users";
import geoRouter from "./geo";
import centersRouter from "./centers";
import departmentsRouter from "./departments";
import academicsRouter from "./academics";
import fctRouter from "./fct";
import aiRouter from "./ai";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(invitationsRouter);
router.use(usersRouter);
router.use(geoRouter);
router.use(centersRouter);
router.use(departmentsRouter);
router.use(academicsRouter);
router.use(fctRouter);
router.use(aiRouter);
router.use(dashboardRouter);
router.use(settingsRouter);

export default router;
