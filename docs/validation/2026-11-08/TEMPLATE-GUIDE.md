# 记录模板填写说明

> **历史快照 / Historical snapshot — 2026-11-08.** 本文保留原验证分支当时的实现、未提交状态和验收记录；“当前”不代表此后主线或移植 PR。PCR/CLI 后续集成必须使用另行记录的检查结果。
> Original validation-branch evidence only; this is not proof that later cross-repository integrations pass. Local paths are replaced with logical source names.
> 原件索引 / Original: `TEMPLATE-GUIDE.md`; 原件与导出件 SHA-256 见 [export-map.json](export-map.json). 未分发材料见 [说明 / omissions](NOT-DISTRIBUTED.md).

三个模板初始只有表头，没有实验观察或虚构参与者。CSV 使用 UTF-8。未知值留空；不要用 0 表示未知 n、时间、误差或哈希。

## 实验单位表

一行对应一个技术测量/采集项目，`record_id` 唯一；`input_id` 引用清单；同一输入含多个孔、ROI 或样本时以 `measurement_selector` 定位，不通过复制文件制造样本。

- `study_id`：研究标识；`module`：WB/IHC/IF/HE/Masson/qPCR。
- `biological_source_id`：动物、供者或培养来源等上层来源；没有资料时未知。
- `experimental_unit_id`：依据干预与推断目标确认的独立单位；它不一定等于上层生物来源或文件。
- `unit_definition`、`unit_confirmed_by`：单位定义及确认者，未知身份不能自动进入生物推断。
- `sample_id`、`technical_measurement_id`：样本与技术测量；`measurement_selector` 记录孔位、ROI、泳道、通道等。
- `acquisition_id`、`section_id`、`field_id`：采集/膜/板、切片与视野的适用层级；不适用留空并在 notes 写明。
- `group`、`pair_id`：设计中的组别及配对；存在 pair_id 不等于当前程序已实现配对检验。
- `source_cluster`：同一来源或派生关系；不明为 `unknown`。
- `development_exposure`、`split`：已用数据标 true/development_regression；未来独立评估需记录未暴露依据。同源裁剪、通道拆分和派生文件保持同一分区。

## 任务登记表

一行一个事先定义的基础任务或其故障版本。`task_id` 唯一；`base_task_id` 将变体关联回基础任务。`input_ids` 多值用分号分隔，`source_cluster` 保存来源关联。

- `evidence_layer`：L1_numeric/L2_detection/L3_user。
- `error_origin`：none/historical_application/historical_reference/injected/user_natural；对未知的未来用户错误，任务注册时使用 none，发生后在结果中引用单独裁定证据。
- `condition`：冻结后的对照条件；`reference_spec_path`、`tolerance_spec_path`、`adjudication_spec_path` 指向实际规范文件。
- `status`：planned/ready/running/completed/cancelled；`planned` 不等于已有可运行fixture。
- `frozen_at_utc`：只有输入、规范、容差和版本锁定后才填写。

## 执行记录表

一行一个执行记录，不把同一任务重跑当成新增独立实验。`run_id` 唯一，关联 task_id、base_task_id、参与者和条件；非用户实验 participant_id 留空。

- `execution_status`：not_started/running/completed/failed/timeout。
- `outcome`：correct_completion/erroneous_submission/appropriate_stop/technical_failure。L1/L2 不强行使用用户任务结局，不适用可留空。
- `error_present`：true/false/unknown；`error_detected`、`output_released`、`false_block` 仅在有定义且完成裁定时填写布尔值。
- `adjudication_status`：pending/agreed/adjudicated/unresolved；`adjudicator_ids`、`evidence_path` 留下裁定依据。
- `elapsed_seconds`、`intervention_count`：实际观测值；不因未完成而记录成零秒。
- `engine_commit`、`config_sha256`、`result_sha256`：记录实际执行状态；不能用当前 HEAD 回填旧结果。
- `review_status`：not_reviewed/needs_review/reviewed；人工 reviewed 不是自动宣称生物结论已验证。

原始采集信息、代码版本、数值核验与人工实验解释各保留自己的状态。错误缺少可观察证据时，自动检查的预期行为应为提示未知或要求补资料，而非假设系统能够判断真相。

## 预设案例的类别与指标分母

`challenge-cases.csv` 是正式评价前的设计。`truth_status=proposed_not_adjudicated` 表示尚未由独立评定者确认标签；不是现成的金标准。`status=software_regression_only` 表示已有对应开发回归证据，不等于冻结案例的盲评完成，也不能直接计入检测率分母；`not_run` 表示尚无本轮对应执行。

`development-backlog.csv` 的 `implemented_software_validated` 表示所列增量实现已通过本轮软件验收；`partially_implemented` 仍有明确未完项；`planned` 仍待开发。这些开发状态与实验真值、科学有效性或论文发表就绪度分别记录。

| case_kind | metric_eligibility | 用途 |
|---|---|---|
| numeric_check | numeric_agreement | 固定方法下的数值核验 |
| injected_fault / historical_fault | detection_and_release | 规定故障的检出和错误输出放行；按 error_origin 分开报告 |
| valid_control | false_alarm_and_false_block | 合法任务中的误报、误阻断 |
| invalid_request | request_validation_only | 不支持请求是否被正确说明；不计入合法任务误报率 |
| scope_display | functional_acceptance_only | 证据状态显示/报告验收；不计入数值准确性或故障检出率 |

任务规范、参考、容差、标签和指标纳入规则冻结后，才将对应计划转成 ready。新造的历史故障变体仍是 injected，不计为真实历史故障观察。
