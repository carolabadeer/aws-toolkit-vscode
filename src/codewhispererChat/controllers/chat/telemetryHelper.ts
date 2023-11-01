/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserIntent } from '@amzn/codewhisperer-streaming'
import {
    CwsprChatTriggerInteraction,
    CwsprChatUserIntent,
    Result,
    telemetry,
} from '../../../shared/telemetry/telemetry'
import { ChatSessionStorage } from '../../storages/chatSession'
import {
    ChatItemFeedbackMessage,
    ChatItemVotedMessage,
    CopyCodeToClipboard,
    InsertCodeAtCursorPosition,
    PromptAnswer,
    PromptMessage,
    TriggerPayload,
} from './model'
import { TriggerEvent, TriggerEventsStorage } from '../../storages/triggerEvents'
import globals from '../../../shared/extensionGlobals'
import { getLogger } from '../../../shared/logger'
import { TabOpenType } from '../../../awsq/webview/ui/storages/tabsStorage'

export class CWCTelemetryHelper {
    private sessionStorage: ChatSessionStorage
    private triggerEventsStorage: TriggerEventsStorage
    private responseStreamStartTime: number = 0
    private responseStreamTotalTime: number = 0
    private responseStreamTimeToFirstChunk: number = 0

    constructor(sessionStorage: ChatSessionStorage, triggerEventsStorage: TriggerEventsStorage) {
        this.sessionStorage = sessionStorage
        this.triggerEventsStorage = triggerEventsStorage
    }

    private getUserIntentForTelemetry(userIntent: UserIntent | undefined): CwsprChatUserIntent | undefined {
        switch (userIntent) {
            case UserIntent.EXPLAIN_CODE_SELECTION:
                return 'explainCodeSelection'
            case UserIntent.SUGGEST_ALTERNATE_IMPLEMENTATION:
                return 'suggestAlternateImplementation'
            case UserIntent.APPLY_COMMON_BEST_PRACTICES:
                return 'applyCommonBestPractices'
            case UserIntent.IMPROVE_CODE:
                return 'improveCode'
            default:
                return undefined
        }
    }

    public recordOpenChat(triggerInteractionType: TabOpenType) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        let cwsprChatTriggerInteraction: CwsprChatTriggerInteraction = 'click'
        switch (triggerInteractionType) {
            case 'click':
                cwsprChatTriggerInteraction = 'click'
                break
            case 'contextMenu':
                cwsprChatTriggerInteraction = 'contextMenu'
                break
            case 'hotkeys':
                cwsprChatTriggerInteraction = 'hotkeys'
                break
        }

        telemetry.codewhispererchat_openChat.emit({ cwsprChatTriggerInteraction })
    }

    public recordCloseChat(tabID: string) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        const conversationId = this.getConversationId(tabID)
        telemetry.codewhispererchat_closeChat.emit({ cwsprChatConversationId: conversationId ?? '' })
    }

    public recordEnterFocusChat() {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        telemetry.codewhispererchat_enterFocusChat.emit()
    }

    public recordExitFocusChat() {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        telemetry.codewhispererchat_exitFocusChat.emit()
    }

    public async recordFeedback(message: ChatItemFeedbackMessage) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }
        const logger = getLogger()
        try {
            await globals.telemetry.postFeedback({
                comment: JSON.stringify({
                    type: 'codewhisperer-chat-answer-feedback',
                    conversationId: this.getConversationId(message.tabID) ?? '',
                    messageId: message.messageId,
                    reason: message.selectedOption,
                    userComment: message.comment,
                }),
                sentiment: 'Negative',
            })
        } catch (err) {
            const errorMessage = (err as Error).message || 'Failed to submit feedback'
            logger.error(`CodeWhispererChat answer feedback failed: "Negative": ${errorMessage}`)

            this.recordFeedbackResult('Failed')

            return errorMessage
        }

        logger.info(`CodeWhispererChat answer feedback sent: "Negative"`)

        this.recordFeedbackResult('Succeeded')
    }

    public recordFeedbackResult(feedbackResult: Result) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        telemetry.feedback_result.emit({ result: feedbackResult })
    }

    public recordInteractWithMessage(
        message: InsertCodeAtCursorPosition | CopyCodeToClipboard | PromptMessage | ChatItemVotedMessage
    ) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        const conversationId = this.getConversationId(message.tabID)

        switch (message.command) {
            case 'insert_code_at_cursor_position':
                //TODO: message id and has reference
                message = message as InsertCodeAtCursorPosition
                telemetry.codewhispererchat_interactWithMessage.emit({
                    cwsprChatConversationId: conversationId ?? '',
                    cwsprChatMessageId: '',
                    cwsprChatInteractionType: 'insertAtCursor',
                    cwsprChatAcceptedCharactersLength: message.code.length,
                    cwsprChatInteractionTarget: message.insertionTargetType,
                    cwsprChatHasReference: undefined,
                })
                break
            case 'code_was_copied_to_clipboard':
                //TODO: message id and has reference
                message = message as CopyCodeToClipboard
                telemetry.codewhispererchat_interactWithMessage.emit({
                    cwsprChatConversationId: conversationId ?? '',
                    cwsprChatMessageId: '',
                    cwsprChatInteractionType: 'copySnippet',
                    cwsprChatAcceptedCharactersLength: message.code.length,
                    cwsprChatInteractionTarget: message.insertionTargetType,
                    cwsprChatHasReference: undefined,
                })
                break
            case 'follow-up-was-clicked':
                //TODO: message id
                message = message as PromptMessage
                telemetry.codewhispererchat_interactWithMessage.emit({
                    cwsprChatConversationId: conversationId ?? '',
                    cwsprChatMessageId: '',
                    cwsprChatInteractionType: 'clickFollowUp',
                })
                break
            case 'chat-item-voted':
                message = message as ChatItemVotedMessage
                telemetry.codewhispererchat_interactWithMessage.emit({
                    // TODO: message id
                    cwsprChatMessageId: message.messageId,
                    cwsprChatConversationId: conversationId ?? '',
                    cwsprChatInteractionType: message.vote,
                })
        }
    }

    public recordStartConversation(triggerEvent: TriggerEvent, triggerPayload: TriggerPayload) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        if (triggerEvent.tabID == undefined) {
            return
        }

        if (this.triggerEventsStorage.getTriggerEventsByTabID(triggerEvent.tabID).length > 1) {
            return
        }

        const telemetryUserIntent = this.getUserIntentForTelemetry(triggerPayload.userIntent)

        telemetry.codewhispererchat_startConversation.emit({
            cwsprChatConversationId: this.getConversationId(triggerEvent.tabID) ?? '',
            cwsprChatConversationType: 'Chat',
            cwsprChatUserIntent: telemetryUserIntent,
            cwsprChatHasCodeSnippet: triggerPayload.codeSelection != undefined,
            cwsprChatProgrammingLanguage: triggerPayload.fileLanguage,
        })
    }

    public recordAddMessage(triggerPayload: TriggerPayload | undefined, message: PromptAnswer) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        const hasCodeSnippet = !triggerPayload?.codeSelection?.isEmpty

        // TODO: add mesasge id, user intent, response code snippet count, response code, references count, time to first chunk, response latency
        telemetry.codewhispererchat_addMessage.emit({
            cwsprChatConversationId: this.getConversationId(message.tabID) ?? '',
            cwsprChatMessageId: '',
            cwsprChatHasCodeSnippet: hasCodeSnippet,
            cwsprChatProgrammingLanguage: triggerPayload?.fileLanguage,
            cwsprChatActiveEditorTotalCharacters: triggerPayload?.fileText?.length ?? 0,
            cwsprChatActiveEditorImportCount: triggerPayload?.matchPolicy?.must?.length ?? 0,
            cwsprChatResponseCodeSnippetCount: 0,
            cwsprChatResponseCode: 0,
            cwsprChatSourceLinkCount: message.suggestionCount,
            cwsprChatReferencesCount: 0,
            cwsprChatFollowUpCount: message.followUpCount,
            cwsprChatTimeToFirstChunk: this.responseStreamTimeToFirstChunk,
            cwsprChatFullResponseLatency: this.responseStreamTotalTime,
            cwsprChatResponseLength: message.messageLength,
            cwsprChatConversationType: 'Chat',
        })
    }

    public recordEnterFocusConversation(tabID: string) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        telemetry.codewhispererchat_enterFocusConversation.emit({
            cwsprChatConversationId: this.getConversationId(tabID) ?? '',
        })
    }

    public recordExitFocusConversation(tabID: string) {
        if (!globals.telemetry.telemetryEnabled) {
            return
        }

        telemetry.codewhispererchat_exitFocusConversation.emit({
            cwsprChatConversationId: this.getConversationId(tabID) ?? '',
        })
    }

    public setResponseStreamStartTime(time: number) {
        this.responseStreamStartTime = time
    }

    public setReponseStreamTimeToFirstChunk(time: number) {
        this.responseStreamTimeToFirstChunk = time - this.responseStreamStartTime
    }

    public setResponseStreamTotalTime(time: number) {
        this.responseStreamTotalTime = time - this.responseStreamStartTime
    }

    private getConversationId(tabID: string): string | undefined {
        return this.sessionStorage.getSession(tabID).sessionIdentifier
    }
}
