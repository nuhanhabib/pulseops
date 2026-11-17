// Evaluated before any other module so the logger tags every line with the right service.
process.env.PULSEOPS_SERVICE ??= "worker";
export {};
