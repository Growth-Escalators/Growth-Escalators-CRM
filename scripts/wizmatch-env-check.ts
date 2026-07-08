import { buildWizmatchEnvReport, formatWizmatchEnvReport } from '../src/services/wizmatchEnvCheck';

const report = buildWizmatchEnvReport(process.env);
console.log(formatWizmatchEnvReport(report));
