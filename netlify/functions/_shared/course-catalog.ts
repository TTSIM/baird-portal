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

export type CourseContentLabels = {
  singular: string;
  plural: string;
};

export type CourseDefinition = {
  id: string;
  title: string;
  shortTitle: string;
  intake: string;
  summary: string;
  status: string;
  statusLabel: string;
  sourceUrl: string;
  contentLabels: CourseContentLabels;
  facultyIds: string[];
  details?: string[][];
  coverImage?: string;
  moduleIds: string[];
};

export type FacultyMember = {
  id: string;
  name: string;
  role: string;
  bio: string;
  image?: string;
  courseIds: string[];
};

export type CourseCatalog = {
  version: number;
  academy: {
    name: string;
    title: string;
    yearsRunning: number;
  };
  faculty: FacultyMember[];
  courses: CourseDefinition[];
  modules: CourseModule[];
};

export const courseCatalog = rawCatalog as CourseCatalog;
export const allModuleIds = new Set(courseCatalog.modules.map((module) => module.id));
export const allCourseIds = new Set(courseCatalog.courses.map((course) => course.id));
export const allFacultyIds = new Set(courseCatalog.faculty.map((member) => member.id));
const moduleById = new Map(courseCatalog.modules.map((module) => [module.id, module]));

for (const course of courseCatalog.courses) {
  for (const moduleId of course.moduleIds) {
    const module = moduleById.get(moduleId);
    if (!module || module.courseId !== course.id) {
      throw new Error(`Course ${course.id} references an invalid module: ${moduleId}`);
    }
  }
  for (const facultyId of course.facultyIds) {
    if (!allFacultyIds.has(facultyId)) {
      throw new Error(`Course ${course.id} references an invalid faculty member: ${facultyId}`);
    }
  }
}

for (const member of courseCatalog.faculty) {
  for (const courseId of member.courseIds) {
    if (!allCourseIds.has(courseId)) {
      throw new Error(`Faculty member ${member.id} references an invalid course: ${courseId}`);
    }
  }
}

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

export function normalizeCompletedCourses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && allCourseIds.has(id)))].sort();
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
  const enrolledCourseIds = new Set(
    courseCatalog.courses
      .filter((course) => course.moduleIds.some((moduleId) => granted.has(moduleId)))
      .map((course) => course.id)
  );
  const modules = courseCatalog.modules
    .filter((module) => enrolledCourseIds.has(module.courseId))
    .map((module) => {
    if (granted.has(module.id)) return { ...module, locked: false };
    return {
      id: module.id,
      courseId: module.courseId,
      title: module.title,
      typeLabel: module.typeLabel,
      date: module.date,
      topics: module.topics,
      locked: true
    };
  });
  const courses = courseCatalog.courses.map((course) => ({
    ...course,
    enrolled: enrolledCourseIds.has(course.id),
    availableItems: course.moduleIds.filter((moduleId) => granted.has(moduleId)).length,
    totalItems: course.moduleIds.length
  }));

  const materialCount = courseCatalog.modules
    .filter((module) => granted.has(module.id))
    .flatMap((module) => module.days || [])
    .flatMap((day) => day.lectures || [])
    .flatMap((lecture) => lecture.materials || [])
    .length;

  return {
    version: courseCatalog.version,
    academy: courseCatalog.academy,
    courses,
    faculty: courseCatalog.faculty,
    modules,
    stats: {
      enrolledCourses: enrolledCourseIds.size,
      availableItems: granted.size,
      faculty: courseCatalog.faculty.length,
      materials: materialCount,
      yearsRunning: courseCatalog.academy.yearsRunning
    }
  };
}

export function publicCourseOptions() {
  return courseCatalog.courses.map(({ id, title, intake }) => ({ id, title, intake }));
}
