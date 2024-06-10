import {
  AutoExperimentWithProject,
  FeatureDefinitionWithProject,
} from "back-end/types/api";
import { IdLists } from "back-end/types/saved-group";
import { pick, omit } from "lodash";
import cloneDeep from "lodash/cloneDeep";
import { SDKCapability } from "./index";

const strictFeatureKeys = ["defaultValue", "rules"];
const strictFeatureRuleKeys = [
  "key",
  "variations",
  "weights",
  "coverage",
  "condition",
  "namespace",
  "force",
  "hashAttribute",
];
const bucketingV2Keys = [
  "hashVersion",
  "range",
  "ranges",
  "meta",
  "filters",
  "seed",
  "name",
  "phase",
];
const stickyBucketingKeys = [
  "fallbackAttribute",
  "disableStickyBucketing",
  "bucketVersion",
  "minBucketVersion",
];
const prerequisiteKeys = ["parentConditions"];

// eslint-disable-next-line
type Node = [string, any];
type NodeModifier = (node: Node) => Node | undefined;

// Modifies the given object in place by calling onNode on each key/value pair and replacing the
// existing entry with the key/value pair returned by onNode if one was returned
// eslint-disable-next-line
const recursiveWalk = (object: any, onNode: NodeModifier) => {
  if (typeof object !== "object") {
    return;
  }
  Object.entries(object).forEach((node) => {
    const result = onNode(node);
    let key = node[0];
    if (result) {
      if (Array.isArray(object)) {
        object.splice(parseInt(key), 1);
      } else {
        delete object[key];
      }
      key = result[0];
      object[key] = result[1];
    }
    recursiveWalk(object[key], onNode);
  });
};

export const scrubFeatures = (
  features: Record<string, FeatureDefinitionWithProject>,
  capabilities: SDKCapability[],
  idLists: IdLists
): Record<string, FeatureDefinitionWithProject> => {
  const allowedFeatureKeys = [...strictFeatureKeys];
  const allowedFeatureRuleKeys = [...strictFeatureRuleKeys];
  if (capabilities.includes("bucketingV2")) {
    allowedFeatureRuleKeys.push(...bucketingV2Keys);
  }
  if (capabilities.includes("stickyBucketing")) {
    allowedFeatureRuleKeys.push(...stickyBucketingKeys);
  }
  if (capabilities.includes("prerequisites")) {
    allowedFeatureRuleKeys.push(...prerequisiteKeys);
  }
  if (!capabilities.includes("savedGroupReferences")) {
    recursiveWalk(features, replaceIdLists(idLists));
  }

  const newFeatures = cloneDeep(features);

  // Remove features that have any gating parentConditions & any rules that have parentConditions
  // Note: Reduction of features and rules is already performed in the back-end
  //   see: reduceFeaturesWithPrerequisites()
  if (!capabilities.includes("prerequisites")) {
    for (const k in newFeatures) {
      // delete feature
      if (
        newFeatures[k]?.rules?.some((rule) =>
          rule?.parentConditions?.some((pc) => !!pc.gate)
        )
      ) {
        delete newFeatures[k];
        continue;
      }
      // delete rules
      newFeatures[k].rules = newFeatures[k].rules?.filter(
        (rule) => (rule.parentConditions?.length ?? 0) === 0
      );
    }
  }

  if (capabilities.includes("looseUnmarshalling")) {
    return newFeatures;
  }

  for (const k in newFeatures) {
    newFeatures[k] = pick(
      newFeatures[k],
      allowedFeatureKeys
    ) as FeatureDefinitionWithProject;
    if (newFeatures[k]?.rules) {
      newFeatures[k].rules = newFeatures[k].rules?.map((rule) => {
        rule = {
          ...pick(rule, allowedFeatureRuleKeys),
        };
        return rule;
      });
    }
  }

  return newFeatures;
};

export const scrubExperiments = (
  experiments: AutoExperimentWithProject[],
  capabilities: SDKCapability[],
  idLists: IdLists
): AutoExperimentWithProject[] => {
  const removedExperimentKeys: string[] = [];
  const supportsPrerequisites = capabilities.includes("prerequisites");
  const supportsRedirects = capabilities.includes("redirects");

  if (!capabilities.includes("savedGroupReferences")) {
    recursiveWalk(experiments, replaceIdLists(idLists));
  }

  if (supportsPrerequisites && supportsRedirects) return experiments;

  if (!supportsPrerequisites) {
    removedExperimentKeys.push(...prerequisiteKeys);
  }

  const newExperiments: AutoExperimentWithProject[] = [];

  for (let experiment of experiments) {
    // Filter out any url redirect auto experiments if not supported
    if (!supportsRedirects && experiment.changeType === "redirect") {
      continue;
    }

    // Filter out experiments that have any parentConditions
    if (
      !supportsPrerequisites &&
      (experiment.parentConditions?.length ?? 0) > 0
    ) {
      continue;
    }

    // Scrub fields from the experiment
    experiment = omit(
      experiment,
      removedExperimentKeys
    ) as AutoExperimentWithProject;

    newExperiments.push(experiment);
  }
  return newExperiments;
};

export const scrubIdLists = (
  idLists: IdLists,
  capabilities: SDKCapability[]
): IdLists | undefined => {
  if (!capabilities.includes("savedGroupReferences")) {
    return undefined;
  }
  return idLists;
};

const replaceIdLists: (idLists: IdLists) => NodeModifier = (
  idLists: IdLists
) => {
  return ([key, value]) => {
    if (key === "$ingroup" || key === "$ningroup") {
      return [key.replace("group", ""), idLists[value] || []];
    }
  };
};
