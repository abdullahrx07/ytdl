import { Router, type IRouter, type Request, type Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";

const router: IRouter = Router();

function findZip(zipFileName: string): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), "../../exports", zipFileName),
    path.resolve(process.cwd(), "exports", zipFileName),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function handleZipDownload(
  req: Request,
  res: Response,
  zipFileName: string,
): void {
  const zipPath = findZip(zipFileName);

  if (!zipPath) {
    req.log.error({ zipPath: zipFileName }, "ZIP file is missing");
    res.status(404).json({
      error: "ZIP file is not available",
    });
    return;
  }

  res.download(zipPath, zipFileName, (error) => {
    if (error && !res.headersSent) {
      req.log.error({ err: error }, "ZIP download failed");
      res.status(500).json({
        error: "Unable to download the ZIP",
      });
    }
  });
}

router.get("/project.zip", (req, res) =>
  handleZipDownload(req, res, "youtube-download-api.zip"),
);
router.get("/title-update.zip", (req, res) =>
  handleZipDownload(req, res, "title-update.zip"),
);

export default router;