import { Router, type IRouter } from "express";
import downloadRouter from "./download";
import healthRouter from "./health";
import projectRouter from "./project";

const router: IRouter = Router();

router.use(healthRouter);
router.use(downloadRouter);
router.use(projectRouter);

export default router;
