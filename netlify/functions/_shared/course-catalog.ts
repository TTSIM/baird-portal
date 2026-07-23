import rawCatalog from "../../../data/course-catalog.json" with { type: "json" };
import type { UserRecord } from "./models.js";
import { hasFullCourseAccess } from "./roles.js";

export type CourseResource = {
  type: string;
  label: string;
  summary?: string;
  file: string;
  protectedPrefixes?: string[];
};

export type CourseLecture = {
  title: string;
  copy: string;
  materials?: CourseResource[];
};

export type CourseDay = {
  title: string;
  copy: string;
  lectures: CourseLecture[];
};

export type CourseModule = {
  id: string;
  courseId: string;
  title: string;
  typeLabel?: string;
  date?: string;
  topics?: string;
  knowledgeFiles?: string[];
  days?: CourseDay[];
};

export type CourseCatalog = {
  version: number;
  program: {
    intake: string;
    title: string;
    subtitle: string;
    yearsRunning: number;
    details: string[][];
    description: string[];
    faculty: string[];
  };
  courses: Array<{ id: string; title: string; intake: string; moduleIds: string[] }>;
  modules: CourseModule[];
};

export const courseCatalog = rawCatalog as CourseCatalog;
export const allModuleIds = new Set(courseCatalog.modules.map((module) => module.id));
export const allCourseIds = new Set(courseCatalog.courses.map((course) => course.id));
const moduleById = new Map(courseCatalog.modules.map((module) => [module.id, module]));

type MaterialAccess = { courseId: string; moduleId: string };
const materialAccess = new Map<string, MaterialAccess>();
const materialPrefixes: Array<{ prefix: string; access: MaterialAccess }> = [];

for (const module of courseCatalog.modules) {
  for (const file of module.knowledgeFiles || []) {
    materialAccess.set(`/${file.replace(/^\/+/, "")}`, { courseId: module.courseId, moduleId: module.id });
  }
  for (const day of module.days || []) {
    for (const lecture of day.lectures || []) {
      for (const resource of lecture.materials || []) {
        const access = { courseId: module.courseId, moduleId: module.id };
        materialAccess.set(`/${resource.file.replace(/^\/+/, "")}`, access);
        for (const prefix of resource.protectedPrefixes || []) {
          materialPrefixes.push({ prefix: `/${prefix.replace(/^\/+/, "")}`, access });
        }
      }
    }
  }
}

export function normalizeGrants(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && allModuleIds.has(id)))].sort();
}

export function courseIdsForGrants(grants: string[]): string[] {
  return [...new Set(grants.map((id) => moduleById.get(id)?.courseId).filter((id): id is string => Boolean(id)))];
}

export function resolveMaterialAccess(pathname: string): MaterialAccess | null {
  const clean = decodeURIComponent(pathname).replace(/\/+/g, "/");
  const exact = materialAccess.get(clean);
  if (exact) return exact;
  return materialPrefixes.find(({ prefix }) => clean.startsWith(prefix))?.access || null;
}

export function resolveKnowledgeAccess(relativePath: string): MaterialAccess | null {
  return resolveMaterialAccess(`/${relativePath.replace(/^\/+/, "")}`);
}

export function userCanAccessModule(user: UserRecord, moduleId: string): boolean {
  return hasFullCourseAccess(user.role) || user.grants.includes(moduleId);
}

export function buildPortalView(user: UserRecord) {
  const fullAccess = hasFullCourseAccess(user.role);
  const granted = new Set(fullAccess ? [...allModuleIds] : user.grants);
  const modules = courseCatalog.modules.map((module) => {
    if (granted.has(module.id)) return { ...module, locked: false };
    return {
      id: module.id,
      courseId: module.courseId,
      title: module.title,
      typeLabel: module.typeLabel,
      locked: true
    };
  });

  const materialCount = courseCatalog.modules
    .filter((module) => granted.has(module.id))
    .flatMap((module) => module.days || [])
    .flatMap((day) => day.lectures || [])
    .flatMap((lecture) => lecture.materials || [])
    .length;

  return {
    version: courseCatalog.version,
    program: courseCatalog.program,
    courses: courseCatalog.courses,
    modules,
    stats: {
      modules: courseCatalog.modules.length,
      faculty: courseCatalog.program.faculty.length,
      materials: materialCount,
      yearsRunning: courseCatalog.program.yearsRunning
    }
  };
}

export function publicCourseOptions() {
  return courseCatalog.courses.map(({ id, title, intake }) => ({ id, title, intake }));
}
