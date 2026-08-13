import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";

const router: IRouter = Router();
const ZIP_FILE_NAME = "youtube-download-api.zip";

function findProjectZip(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), "../../exports", ZIP_FILE_NAME),
    path.resolve(process.cwd(), "exports", ZIP_FILE_NAME),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function handleProjectDownload(req: Request, res: Response): void {
  const zipPath = findProjectZip();

  if (!zipPath) {
    req.log.error({ zipPath: ZIP_FILE_NAME }, "Project ZIP file is missing");
    res.status(404).json({
      error: "Project ZIP file is not available",
    });
    return;
  }

  res.download(zipPath, ZIP_FILE_NAME, (error) => {
    if (error && !res.headersSent) {
      req.log.error({ err: error }, "Project ZIP download failed");
      res.status(500).json({
        error: "Unable to download the project ZIP",
      });
    }
  });
}

router.get("/project.zip", handleProjectDownload);

export default router;