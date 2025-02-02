<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useFetchFromServiceControl } from "../../composables/serviceServiceControlUrls";
import { useUnarchiveMessage, useArchiveMessage, useRetryMessages } from "../../composables/serviceFailedMessage";
import { useServiceControlUrls } from "../../composables/serviceServiceControlUrls";
import { useDownloadFile } from "../../composables/fileDownloadCreator";
import { useShowToast } from "../../composables/toast.js";
import NoData from "../NoData.vue";
import TimeSince from "../TimeSince.vue";
import moment from "moment";
import ConfirmDialog from "../ConfirmDialog.vue";
import FlowDiagram from "./FlowDiagram.vue";
import EditRetryDialog from "./EditRetryDialog.vue";

let refreshInterval = undefined;
let pollingFaster = false;
let panel = ref();
const route = useRoute();
const failedMessage = ref({});
const configuration = ref([]);

const id = computed(() => route.params.id);
watch(id, async () => await loadFailedMessage());

const showDeleteConfirm = ref(false);
const showRestoreConfirm = ref(false);
const showRetryConfirm = ref(false);
const showEditRetryModal = ref(false);

function loadFailedMessage() {
  return useFetchFromServiceControl("errors/last/" + id.value)
    .then((response) => {
      if (response.status === 404) {
        failedMessage.value = { notFound: true };
      } else if (response.status !== 200) {
        failedMessage.value = { error: true };
      }
      return response.json();
    })
    .then((data) => {
      var message = data;
      message.archived = message.status === "archived";
      message.resolved = message.status === "resolved";
      message.retried = message.status === "retryIssued";
      message.error_retention_period = moment.duration(configuration.value.data_retention.error_retention_period).asHours();
      message.isEditAndRetryEnabled = configuration.value.edit.enabled;

      // Maintain the mutations of the message in memory until the api returns a newer modified message
      if (failedMessage.value.last_modified === message.last_modified) {
        message.retried = failedMessage.value.retried;
        message.archiving = failedMessage.value.archiving;
        message.restoring = failedMessage.value.restoring;
      } else {
        message.archiving = false;
        message.restoring = false;
      }

      Object.assign(failedMessage.value, message);
      updateMessageDeleteDate();
      return downloadHeadersAndBody();
    })
    .catch((err) => {
      console.log(err);
      return;
    });
}

function getConfiguration() {
  return useFetchFromServiceControl("configuration")
    .then((response) => {
      return response.json();
    })
    .then((data) => {
      configuration.value = data;
      return getEditAndRetryConfig();
    });
}

function getEditAndRetryConfig() {
  return useFetchFromServiceControl("edit/config")
    .then((response) => {
      return response.json();
    })
    .then((data) => {
      configuration.value.edit = data;
      return;
    });
}

function updateMessageDeleteDate() {
  var countdown = moment(failedMessage.value.last_modified).add(failedMessage.value.error_retention_period, "hours");
  failedMessage.value.delete_soon = countdown < moment();
  failedMessage.value.deleted_in = countdown.format();
}

function archiveMessage() {
  useShowToast("info", "Info", `Deleting the message ${id.value} ...`);
  changeRefreshInterval(1000); // We've started an archive, so increase the polling frequency
  return useArchiveMessage([id.value])
    .then((response) => {
      if (response !== undefined) {
        failedMessage.value.archiving = true;
        return;
      }
      return false;
    })
    .catch((err) => {
      console.log(err);
      return false;
    });
}

function unarchiveMessage() {
  changeRefreshInterval(1000); // We've started an unarchive, so increase the polling frequency
  return useUnarchiveMessage([id.value])
    .then((response) => {
      if (response !== undefined) {
        failedMessage.value.restoring = true;
      }
      return false;
    })
    .catch((err) => {
      console.log(err);
      return false;
    });
}

function retryMessage() {
  useShowToast("info", "Info", `Retrying the message ${id.value} ...`);
  changeRefreshInterval(1000); // We've started a retry, so increase the polling frequency
  return useRetryMessages([id.value])
    .then(() => {
      failedMessage.value.retried = true;
    })
    .catch((err) => {
      console.log(err);
      return false;
    });
}

function downloadHeadersAndBody() {
  return useFetchFromServiceControl("messages/search/" + failedMessage.value.message_id)
    .then((response) => {
      return response.json();
    })
    .then((data) => {
      if (data[0] === undefined) {
        failedMessage.value.headersNotFound = true;
        failedMessage.value.messageBodyNotFound = true;
        return;
      }

      var message = data[0];
      failedMessage.value.headers = message.headers;
      failedMessage.value.conversationId = message.headers.find((header) => header.key === "NServiceBus.ConversationId").value;

      return downloadBody();
    })
    .catch((err) => {
      console.log(err);
      return;
    });
}

function downloadBody() {
  return useFetchFromServiceControl("messages/" + failedMessage.value.message_id + "/body").then((response) => {
    if (response.status === 404) {
      failedMessage.value.messageBodyNotFound = true;
    }

    if (response.headers.get("content-type") == "application/json") {
      return response
        .json()
        .then((jsonBody) => {
          jsonBody = JSON.parse(JSON.stringify(jsonBody).replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? "" : m)));

          failedMessage.value.messageBody = formatJson(jsonBody);
        })
        .catch(() => {
          failedMessage.value.bodyUnavailable = true;
        });
    }

    if (response.headers.get("content-type") == "text/xml") {
      return response
        .text()
        .then((xmlBody) => {
          failedMessage.value.messageBody = formatXml(xmlBody);
        })
        .catch(() => {
          failedMessage.value.bodyUnavailable = true;
        });
    }

    return response.text().then((textBody) => {
      failedMessage.value.messageBody = textBody;
    });
  });
}

// taken from https://github.com/krtnio/angular-pretty-xml/blob/master/src/angular-pretty-xml.js
function formatXml(xml) {
  function createShiftArr(step) {
    let space = "";
    if (isNaN(parseInt(step))) {
      // argument is string
      space = step;
    } else {
      // argument is integer
      for (let i = 0; i < step; i++) {
        space += " ";
      }
    }

    let shift = ["\n"]; // array of shifts

    for (let ix = 0; ix < 100; ix++) {
      shift.push(shift[ix] + space);
    }

    return shift;
  }

  const indent = "\t";

  let arr = xml
    .replace(/>\s*</gm, "><")
    .replace(/</g, "~::~<")
    .replace(/\s*xmlns([=:])/g, "~::~xmlns$1")
    .split("~::~");

  let len = arr.length,
    inComment = false,
    depth = 0,
    string = "",
    shift = createShiftArr(indent);

  for (let i = 0; i < len; i++) {
    // start comment or <![CDATA[...]]> or <!DOCTYPE //
    if (arr[i].indexOf("<!") !== -1) {
      string += shift[depth] + arr[i];
      inComment = true;

      // end comment or <![CDATA[...]]> //
      if (arr[i].indexOf("-->") !== -1 || arr[i].indexOf("]>") !== -1 || arr[i].indexOf("!DOCTYPE") !== -1) {
        inComment = false;
      }
    } else if (arr[i].indexOf("-->") !== -1 || arr[i].indexOf("]>") !== -1) {
      // end comment  or <![CDATA[...]]> //
      string += arr[i];
      inComment = false;
    } else if (
      /^<\w/.test(arr[i - 1]) &&
      /^<\/\w/.test(arr[i]) && // <elm></elm> //
      /^<[\w:\-.,]+/.exec(arr[i - 1])[0] === /^<\/[\w:\-.,]+/.exec(arr[i])[0].replace("/", "")
    ) {
      string += arr[i];
      if (!inComment) depth--;
    } else if (arr[i].search(/<\w/) !== -1 && arr[i].indexOf("</") === -1 && arr[i].indexOf("/>") === -1) {
      // <elm> //
      string += !inComment ? shift[depth++] + arr[i] : arr[i];
    } else if (arr[i].search(/<\w/) !== -1 && arr[i].indexOf("</") !== -1) {
      // <elm>...</elm> //
      string += !inComment ? shift[depth] + arr[i] : arr[i];
    } else if (arr[i].search(/<\//) > -1) {
      // </elm> //
      string += !inComment ? shift[--depth] + arr[i] : arr[i];
    } else if (arr[i].indexOf("/>") !== -1) {
      // <elm/> //
      string += !inComment ? shift[depth] + arr[i] : arr[i];
    } else if (arr[i].indexOf("<?") !== -1) {
      // <? xml ... ?> //
      string += shift[depth] + arr[i];
    } else if (arr[i].indexOf("xmlns:") !== -1 || arr[i].indexOf("xmlns=") !== -1) {
      // xmlns //
      string += shift[depth] + arr[i];
    } else {
      string += arr[i];
    }
  }

  return string.trim();
}

function formatJson(json) {
  return JSON.stringify(json, null, 2);
}

function togglePanel(panelNum) {
  if (!failedMessage.value.notFound && !failedMessage.value.error) {
    panel.value = panelNum;
  }
  return false;
}

function debugInServiceInsight() {
  const messageId = failedMessage.value.message_id;
  const endpointName = failedMessage.value.receiving_endpoint.name;
  let serviceControlUrl = useServiceControlUrls().serviceControlUrl.value.toLowerCase();

  if (serviceControlUrl.indexOf("https") === 0) {
    serviceControlUrl = serviceControlUrl.replace("https://", "");
  } else {
    serviceControlUrl = serviceControlUrl.replace("http://", "");
  }

  window.open("si://" + serviceControlUrl + "?search=" + messageId + "&endpointname=" + endpointName);
}

function exportMessage() {
  let txtStr = "STACKTRACE\n";
  txtStr += failedMessage.value.exception.stack_trace;

  txtStr += "\n\nHEADERS";
  for (var i = 0; i < failedMessage.value.headers.length; i++) {
    txtStr += "\n" + failedMessage.value.headers[i].key + ": " + failedMessage.value.headers[i].value;
  }

  txtStr += "\n\nMESSAGE BODY\n";
  txtStr += failedMessage.value.messageBody;

  useDownloadFile(txtStr, "text/txt", "failedMessage.txt");
  useShowToast("info", "Info", "Message export completed.");
}

function showEditAndRetryModal() {
  showEditRetryModal.value = true;
  return stopRefreshInterval();
}

function cancelEditAndRetry() {
  showEditRetryModal.value = false;
  loadFailedMessage(); // Reset the message object when canceling the edit & retry modal
  return startRefreshInterval();
}

function confirmEditAndRetry() {
  showEditRetryModal.value = false;
  useShowToast("info", "Info", `Retrying the edited message ${id.value} ...`);
  return startRefreshInterval();
}

function startRefreshInterval() {
  stopRefreshInterval(); // clear interval if it exists to prevent memory leaks

  refreshInterval = setInterval(() => {
    loadFailedMessage();
  }, 5000);
}

function stopRefreshInterval() {
  if (typeof refreshInterval !== "undefined") {
    clearInterval(refreshInterval);
  }
}

function isRetryOrArchiveOperationInProgress() {
  return failedMessage.value.retried || failedMessage.value.archiving || failedMessage.value.restoring;
}

function changeRefreshInterval(milliseconds) {
  stopRefreshInterval(); // clear interval if it exists to prevent memory leaks

  refreshInterval = setInterval(() => {
    // If we're currently polling at the default interval of 5 seconds and there is a retry, delete, or restore in progress, then change the polling interval
    if (!pollingFaster && isRetryOrArchiveOperationInProgress()) {
      changeRefreshInterval(milliseconds);
      pollingFaster = true;
    } else if (pollingFaster && !isRetryOrArchiveOperationInProgress()) {
      // Reset polling to default value after every retry, delete, and restore. Change polling frequency back to every 5 seconds
      changeRefreshInterval(5000);
      pollingFaster = false;
    }
    loadFailedMessage();
  }, milliseconds);
}

onMounted(() => {
  togglePanel(1);

  getConfiguration().then(() => {
    startRefreshInterval();
    return loadFailedMessage();
  });
});

onUnmounted(() => {
  stopRefreshInterval();
});
</script>

<template>
  <div class="container">
    <section>
      <section name="failed_message">
        <no-data v-if="failedMessage?.notFound" title="message failures" message="Could not find message. This could be because the message URL is invalid or the corresponding message was processed and is no longer tracked by ServiceControl."></no-data>
        <no-data v-if="failedMessage?.error" title="message failures" message="An error occurred while trying to load the message. Please check the ServiceControl logs to learn what the issue is."></no-data>
        <div v-if="!failedMessage?.error && !failedMessage?.notFound">
          <div class="row">
            <div class="col-sm-12 no-side-padding">
              <div class="active break group-title">
                <h1 class="message-type-title">{{ failedMessage.message_type }}</h1>
              </div>
            </div>
          </div>
          <div class="row">
            <div class="col-sm-12 no-side-padding">
              <div class="metadata group-message-count message-metadata">
                <span v-if="failedMessage.retried" title="Message is being retried" class="label sidebar-label label-info metadata-label">Retried</span>
                <span v-if="failedMessage.restoring" title="Message is being retried" class="label sidebar-label label-info metadata-label">Restoring...</span>
                <span v-if="failedMessage.archiving" title="Message is being deleted" class="label sidebar-label label-info metadata-label">Deleting...</span>
                <span v-if="failedMessage.archived" title="Message is being deleted" class="label sidebar-label label-warning metadata-label">Deleted</span>
                <span v-if="failedMessage.resolved" title="Message was processed successfully" class="label sidebar-label label-warning metadata-label">Processed</span>
                <span v-if="failedMessage.number_of_processing_attempts > 1" :title="'This message has already failed ' + failedMessage.number_of_processing_attempts + ' times'" class="label sidebar-label label-important metadata-label">{{ failedMessage.number_of_processing_attempts }} Retry Failures</span>
                <span v-if="failedMessage.edited" tooltip="Message was edited" class="label sidebar-label label-info metadata-label">Edited</span>
                <span v-if="failedMessage.edited" class="metadata metadata-link"><i class="fa fa-history"></i> <RouterLink :to="`/failed-messages/message/${failedMessage.edit_of}`">View previous version</RouterLink></span>
                <span v-if="failedMessage.time_of_failure" class="metadata"><i class="fa fa-clock-o"></i> Failed: <time-since :date-utc="failedMessage.time_of_failure"></time-since></span>
                <span class="metadata"><i class="fa pa-endpoint"></i> Endpoint: {{ failedMessage.receiving_endpoint?.name }}</span>
                <span class="metadata"><i class="fa fa-laptop"></i> Machine: {{ failedMessage.receiving_endpoint?.host }}</span>
                <span v-if="failedMessage.redirect" class="metadata"><i class="fa pa-redirect-source pa-redirect-small"></i> Redirect: {{ failedMessage.redirect }}</span>
              </div>
              <div class="metadata group-message-count message-metadata" v-if="failedMessage.archived">
                <span class="metadata"><i class="fa fa-clock-o"></i> Deleted: <time-since :date-utc="failedMessage.last_modified"></time-since></span>
                <span class="metadata danger" v-if="failedMessage.delete_soon"><i class="fa fa-trash-o danger"></i> Scheduled for permanent deletion: immediately</span>
                <span class="metadata danger" v-if="!failedMessage.delete_soon"><i class="fa fa-trash-o danger"></i> Scheduled for permanent deletion: <time-since :date-utc="failedMessage.deleted_in"></time-since></span>
              </div>
            </div>
          </div>
          <div class="row">
            <div class="col-sm-12 no-side-padding">
              <div class="btn-toolbar message-toolbar">
                <button type="button" class="btn btn-default" v-if="!failedMessage.archived" :disabled="failedMessage.retried || failedMessage.resolved" @click="showDeleteConfirm = true"><i class="fa fa-trash"></i> Delete message</button>
                <button type="button" class="btn btn-default" v-if="failedMessage.archived" @click="showRestoreConfirm = true"><i class="fa fa-undo"></i> Restore</button>
                <button type="button" class="btn btn-default" :disabled="failedMessage.retried || failedMessage.archived || failedMessage.resolved" @click="showRetryConfirm = true"><i class="fa fa-refresh"></i> Retry message</button>
                <button type="button" class="btn btn-default" v-if="failedMessage.isEditAndRetryEnabled" @click="showEditAndRetryModal()"><i class="fa fa-pencil"></i> Edit & retry</button>
                <button type="button" class="btn btn-default" @click="debugInServiceInsight()" title="Browse this message in ServiceInsight, if installed"><img src="@/assets/si-icon.svg" /> View in ServiceInsight</button>
                <button type="button" class="btn btn-default" v-if="!failedMessage.notFound && !failedMessage.error" @click="exportMessage()"><i class="fa fa-download"></i> Export message</button>
              </div>
            </div>
          </div>
          <div class="row">
            <div class="col-sm-12 no-side-padding">
              <div class="nav tabs msg-tabs">
                <h5 :class="{ active: panel === 1 }" class="nav-item" @click="togglePanel(1)"><a href="javascript:void(0)">Stacktrace</a></h5>
                <h5 :class="{ active: panel === 2 }" class="nav-item" @click="togglePanel(2)"><a href="javascript:void(0)">Headers</a></h5>
                <h5 :class="{ active: panel === 3 }" class="nav-item" @click="togglePanel(3)"><a href="javascript:void(0)">Message body</a></h5>
                <h5 :class="{ active: panel === 4 }" class="nav-item" @click="togglePanel(4)"><a href="javascript:void(0)">Flow Diagram</a></h5>
              </div>
              <pre v-if="panel === 0">{{ failedMessage.exception?.message }}</pre>
              <pre v-if="panel === 1">{{ failedMessage.exception?.stack_trace }}</pre>
              <table class="table" v-if="panel === 2 && !failedMessage.headersNotFound">
                <tbody>
                  <tr class="interactiveList" v-for="(header, index) in failedMessage.headers" :key="index">
                    <td nowrap="nowrap">{{ header.key }}</td>
                    <td>
                      <pre>{{ header.value }}</pre>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="panel === 2 && failedMessage.headersNotFound" class="alert alert-info">Could not find message headers. This could be because the message URL is invalid or the corresponding message was processed and is no longer tracked by ServiceControl.</div>
              <pre v-if="panel === 3 && !failedMessage.messageBodyNotFound && !failedMessage.bodyUnavailable">{{ failedMessage.messageBody }}</pre>
              <div v-if="panel === 3 && failedMessage.messageBodyNotFound" class="alert alert-info">Could not find message body. This could be because the message URL is invalid or the corresponding message was processed and is no longer tracked by ServiceControl.</div>
              <div v-if="panel === 3 && failedMessage.bodyUnavailable" class="alert alert-info">Message body unavailable.</div>
              <FlowDiagram v-if="panel === 4" :conversation-id="failedMessage.conversationId" :message-id="route.params.id"></FlowDiagram>
            </div>
          </div>

          <!--modal display - restore group-->
          <Teleport to="#modalDisplay">
            <ConfirmDialog
              v-if="showDeleteConfirm === true"
              @cancel="showDeleteConfirm = false"
              @confirm="
                showDeleteConfirm = false;
                archiveMessage();
              "
              :heading="'Are you sure you want to delete this message?'"
              :body="'If you delete, this message won\'t be available for retrying unless it is later restored.'"
            ></ConfirmDialog>

            <ConfirmDialog
              v-if="showRestoreConfirm === true"
              @cancel="showRestoreConfirm = false"
              @confirm="
                showRestoreConfirm = false;
                unarchiveMessage();
              "
              :heading="'Are you sure you want to restore this message?'"
              :body="'The restored message will be moved back to the list of failed messages.'"
            ></ConfirmDialog>

            <ConfirmDialog
              v-if="showRetryConfirm === true"
              @cancel="showRetryConfirm = false"
              @confirm="
                showRetryConfirm = false;
                retryMessage();
              "
              :heading="'Are you sure you want to retry this message?'"
              :body="'Are you sure you want to retry this message?'"
            ></ConfirmDialog>

            <EditRetryDialog v-if="showEditRetryModal === true" @cancel="cancelEditAndRetry()" @retried="confirmEditAndRetry()" :id="id" :message="failedMessage" :configuration="configuration.edit"></EditRetryDialog>
          </Teleport>
        </div>
      </section>
    </section>
  </div>
</template>

<style>
h1.message-type-title {
  margin: 0 0 8px;
  font-size: 24px;
}

.message-metadata {
  display: inline;
}

div.btn-toolbar.message-toolbar {
  margin-bottom: 20px;
}

button img {
  position: relative;
  top: -1px;
  width: 17px;
}

.msg-tabs {
  margin-bottom: 20px;
}
</style>
