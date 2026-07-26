import { projectPaths } from "../config";
import { validateContentDirectory } from "../application/validate-content";

const paths = projectPaths();
const reports = await validateContentDirectory(paths.dailyContent);
process.stdout.write(`Validated ${reports.length} daily reports and their correction links.\n`);
