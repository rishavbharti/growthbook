import { useState, useEffect, useCallback } from "react";
import {
  AutoFactTableTrackedEvent,
  InformationSchemaInterface,
} from "@back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@back-end/types/datasource";
import { cloneDeep } from "lodash";
import { useForm } from "react-hook-form";
import { FaRedo } from "react-icons/fa";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { DocLink } from "./DocLink";
import Modal from "./Modal";
import Tooltip from "./Tooltip/Tooltip";
import SelectField from "./Forms/SelectField";
import LoadingOverlay from "./LoadingOverlay";
import LoadingSpinner from "./LoadingSpinner";
import Toggle from "./Forms/Toggle";

type Props = {
  setShowAutoGenerateFactTableModal: (show: boolean) => void;
  datasource?: DataSourceInterfaceWithParams;
  source: string;
  mutate: () => void;
};

export default function AutoGenerateFactTableModal({
  setShowAutoGenerateFactTableModal,
  datasource,
  source,
  mutate,
}: Props) {
  const [autoMetricError, setAutoMetricError] = useState("");
  const { datasources } = useDefinitions();
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);
  const { getDatasourceById } = useDefinitions();
  const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);
  const [refreshingSchema, setRefreshingSchema] = useState(false);
  const [retryCount, setRetryCount] = useState(1);
  const [refreshingSchemaError, setRefreshingSchemaError] = useState("");
  const [selectedDatasourceData, setSelectedDatasourceData] = useState<{
    informationSchema: InformationSchemaInterface | undefined;
  }>({
    informationSchema: undefined,
  });

  const form = useForm<{
    datasourceId: string;
    schema: string;
    factTablesToCreate: AutoFactTableTrackedEvent[];
  }>({
    defaultValues: {
      datasourceId: datasource?.id || "",
      schema: "",
      factTablesToCreate: [],
    },
  });

  const selectedSchema = form.watch("schema");
  const factTablesToCreate = form.watch("factTablesToCreate");

  const selectedDatasource =
    datasource || getDatasourceById(form.watch("datasourceId"));

  const schemaName =
    selectedDatasource?.type === "bigquery"
      ? "Dataset"
      : selectedDatasource?.type === "athena"
      ? "Catalog"
      : "Schema";

  const submit = form.handleSubmit(async (data) => {
    setAutoMetricError("");
    //MKTODO: Update this tracking call
    // track("Generating Auto Metrics For User", {
    //   autoMetricsCreated: {
    //     countMetrics: data.metricsToCreate.filter((m) => m.type === "count")
    //       .length,
    //     binomialMetrics: data.metricsToCreate.filter(
    //       (m) => m.type === "binomial"
    //     ).length,
    //   },
    //   source,
    //   type: selectedDatasource?.type,
    //   dataSourceId: selectedDatasource?.id,
    //   schema: selectedDatasource?.settings.schemaFormat,
    // });

    if (!selectedDatasource?.id) {
      setAutoMetricError("Must select a data source before submitting");
      return;
    }

    await apiCall(`/fact-tables/auto-tables`, {
      method: "POST",
      body: JSON.stringify({
        datasourceId: selectedDatasource.id,
        factTablesToCreate: data.factTablesToCreate
          .filter((table) => table.shouldCreate === true)
          .map((table) => {
            return {
              name: table.eventName,
              sql: table.sql,
            };
          }),
      }),
    });

    //MKTODO: Should I wrap this in a try/catch and handle errors better? If so, I should apply the same changes to AutoGenerateMetricsModal
    mutate();
  });

  const getTrackedEvents = useCallback(
    async (datasourceObj: DataSourceInterfaceWithParams | undefined) => {
      setAutoMetricError("");
      if (
        !datasourceObj ||
        !datasourceObj?.properties?.supportsAutoGeneratedMetrics
      ) {
        return;
      }

      if (
        datasourceObj.settings.schemaFormat === "amplitude" &&
        !datasourceObj.settings?.schemaOptions?.projectId
      ) {
        setAutoMetricError(
          "Missing Amplitude Project Id - Click the 'Edit Connection Info' button at the top of this page to add your project id."
        );
        return;
      }
      try {
        setLoading(true);
        form.setValue("factTablesToCreate", []);
        //MKTODO: Update this
        track("Generate Auto Metrics CTA Clicked", {
          source,
          type: datasourceObj.type,
          dataSourceId: datasourceObj.id,
          schema: datasourceObj?.settings.schemaFormat,
          newDatasourceForm: true,
        });
        const res = await apiCall<{
          autoFactTablesToCreate: AutoFactTableTrackedEvent[];
          message?: string;
        }>(`/fact-tables/tracked-events/${datasourceObj.id}`, {
          method: "POST",
          body: JSON.stringify({ schema: selectedSchema }),
        });
        setLoading(false);
        if (res.message) {
          track("Generate Auto Metrics Error", {
            error: res.message,
            source,
            type: datasourceObj.type,
            dataSourceId: datasourceObj.id,
            schema: datasourceObj.settings.schemaFormat,
            newDatasourceForm: true,
          });
          setAutoMetricError(res.message);
          return;
        }
        form.setValue("factTablesToCreate", res.autoFactTablesToCreate);
      } catch (e) {
        track("Generate Auto Metrics Error", {
          error: e.message,
          source,
          type: datasourceObj.type,
          dataSourceId: datasourceObj.id,
          schema: datasourceObj.settings.schemaFormat,
          newDatasourceForm: true,
        });
        setAutoMetricError(e.message);
      }
    },
    [apiCall, form, selectedSchema, source]
  );

  useEffect(() => {
    if (!selectedDatasource) return;

    if (!selectedSchema && availableSchemas.length === 1) {
      form.setValue("schema", availableSchemas[0]);
    }

    if (!selectedSchema) return;

    getTrackedEvents(selectedDatasource);
  }, [
    availableSchemas,
    form,
    getTrackedEvents,
    selectedDatasource,
    selectedSchema,
  ]);

  useEffect(() => {
    if (selectedDatasourceData?.informationSchema) {
      const schemas: string[] = [];
      selectedDatasourceData.informationSchema.databases.forEach((database) => {
        database.schemas.forEach((schema) => {
          schemas.push(schema.schemaName);
        });
      });
      setAvailableSchemas(schemas);
    }
  }, [selectedDatasourceData?.informationSchema]);

  useEffect(() => {
    if (refreshingSchema) {
      if (
        retryCount > 1 &&
        retryCount < 8 &&
        selectedDatasourceData?.informationSchema?.status === "COMPLETE"
      ) {
        setRefreshingSchema(false);
        setRetryCount(1);
      } else if (retryCount > 8) {
        setRefreshingSchema(false);
        setRefreshingSchemaError(
          "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes."
        );
        setRetryCount(1);
      } else {
        const timer = setTimeout(() => {
          mutate();
          setRetryCount(retryCount * 2);
        }, retryCount * 1000);
        return () => {
          clearTimeout(timer);
        };
      }
    }
  }, [
    refreshingSchema,
    mutate,
    retryCount,
    selectedDatasourceData?.informationSchema?.status,
  ]);

  useEffect(() => {
    async function getInformationSchema(dataSourceId: string) {
      const { informationSchema } = await apiCall<{
        status: number;
        informationSchema?: InformationSchemaInterface;
      }>(`/datasource/${dataSourceId}/schema`, {});
      if (informationSchema?.error?.message) {
        setAutoMetricError(informationSchema.error.message);
      }
      setSelectedDatasourceData({ informationSchema });
    }

    if (selectedDatasource?.id) {
      getInformationSchema(selectedDatasource.id);
    }
  }, [apiCall, selectedDatasource?.id]);

  return (
    <Modal
      size="lg"
      open={true}
      header="Discover Fact Tables"
      close={() => setShowAutoGenerateFactTableModal(false)}
      submit={submit}
      cta={`Create Fact Table${
        form.watch("factTablesToCreate").length === 1 ? "" : "s"
      }`}
      ctaEnabled={form.watch("factTablesToCreate").length > 0}
    >
      <>
        <h4>Generate Fact Tables Automatically</h4>
        <p>
          Select a datasource below to see if we&apos;re able to generate fact
          tables for you automatically, based on your tracked events.{" "}
          <DocLink docSection={"autoMetrics"}>Learn More</DocLink>
        </p>
        <SelectField
          label="Select A Data Source"
          value={selectedDatasource?.id || ""}
          onChange={(datasourceId) => {
            form.setValue("datasourceId", datasourceId);
          }}
          options={(datasources || []).map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
          name="datasource"
          disabled={datasource ? true : false}
        />
        {availableSchemas.length > 1 ? (
          <SelectField
            disabled={
              !selectedDatasource?.properties?.supportsAutoGeneratedMetrics
            }
            label={
              <div className="d-flex align-items-center">
                Select a {schemaName}
                {selectedDatasource?.id ? (
                  <Tooltip
                    body={`Refresh list of ${schemaName.toLocaleLowerCase()}s`}
                    tipPosition="top"
                  >
                    <button
                      className="btn btn-link p-0 pl-1 text-secondary"
                      disabled={refreshingSchema}
                      onClick={async (e) => {
                        e.preventDefault();
                        setRefreshingSchemaError("");
                        try {
                          await apiCall<{
                            status: number;
                            message?: string;
                          }>(`/datasource/${selectedDatasource.id}/schema`, {
                            method: "PUT",
                            body: JSON.stringify({
                              informationSchemaId:
                                selectedDatasource.settings.informationSchemaId,
                            }),
                          });
                          setRefreshingSchema(true);
                        } catch (e) {
                          setRefreshingSchemaError(e.message);
                        }
                      }}
                    >
                      {refreshingSchema ? <LoadingSpinner /> : <FaRedo />}
                    </button>
                  </Tooltip>
                ) : null}
              </div>
            }
            value={form.watch("schema") || ""}
            onChange={(schema) => {
              form.setValue("schema", schema);
            }}
            options={availableSchemas.map((schema) => ({
              value: schema,
              label: schema,
            }))}
          />
        ) : null}
        {loading ? <LoadingOverlay /> : null}
        {selectedDatasource &&
        !selectedDatasource?.properties?.supportsAutoGeneratedMetrics ? (
          <div className="alert alert-warning">
            Sorry - this data source does not support auto generated metrics.{" "}
            <DocLink docSection={"metrics"}>Learn More</DocLink>
          </div>
        ) : null}
        {factTablesToCreate.length > 0 ? (
          <div>
            <p className="alert alert-info">
              These are the tracked events we found that we can use to
              automatically generate the following Fact Tables for you. And
              don&apos;t worry, you can always edit and remove these Fact Tables
              at anytime after they&apos;re created.{" "}
              <DocLink docSection={"factTables"}>
                Click here to learn more about GrowthBook Fact Tables.
              </DocLink>
            </p>
            <table className="appbox table experiment-table gbtable">
              <thead>
                <tr>
                  <th>Create</th>
                  <th>Event Name</th>
                  <th className="text-center">SQL</th>
                </tr>
              </thead>
              <tbody>
                {factTablesToCreate.map((table, i) => {
                  return (
                    <tr key={`${table}-${i}`}>
                      <td>
                        <Toggle
                          id={table.eventName}
                          disabledMessage="This event has already been used to create a Fact Table"
                          disabled={table.alreadyExists}
                          value={table.shouldCreate}
                          setValue={(value) => {
                            const updatedFactTablesToCreate = cloneDeep(
                              factTablesToCreate
                            );
                            updatedFactTablesToCreate[i].shouldCreate = value;
                            form.setValue(
                              "factTablesToCreate",
                              updatedFactTablesToCreate
                            );
                          }}
                        />
                      </td>
                      <td>{table.displayName}</td>
                      <td>{table.sql}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {autoMetricError && (
          <div className="alert alert-danger">
            <p>
              We were unable to identify any metrics to generate for you
              automatically. The query we ran to identify metrics returned the
              following error.
            </p>
            <div>
              <strong>Error: {autoMetricError}</strong>
            </div>
          </div>
        )}
        {refreshingSchema ? (
          <div className="alert alert-info">
            Refreshing list of {schemaName.toLocaleLowerCase()}s...
          </div>
        ) : null}
        {refreshingSchemaError ? (
          <div className="alert alert-danger">{refreshingSchemaError}</div>
        ) : null}
      </>
    </Modal>
  );
}
