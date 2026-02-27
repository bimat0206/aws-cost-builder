// tests/core/models/run_result.test.js
// Property tests for core run result models.
// Feature: aws-cost-profile-builder, Property 3: Run Result Model Correctness
// Validates: Requirements 1.6, 12.1, 12.2, 12.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    DimensionResult,
    ServiceMetrics,
    ServiceResult,
    GroupResult,
    RunResult
} from '../../../core/models/run_result.js';

describe('Run Result Models', () => {
    describe('DimensionResult', () => {
        it('should create a dimension result with default status filled', () => {
            const result = new DimensionResult({ key: 'Test' });
            
            expect(result.key).toBe('Test');
            expect(result.status).toBe('filled');
            expect(result.isFilled()).toBe(true);
            expect(result.isSkipped()).toBe(false);
            expect(result.isFailed()).toBe(false);
        });

        it('should convert to object and back (round-trip)', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        key: fc.string().filter(s => s.length > 0),
                        status: fc.constantFrom('filled', 'skipped', 'failed'),
                        error_detail: fc.oneof(fc.string(), fc.constant(null)),
                        screenshot_path: fc.oneof(fc.string(), fc.constant(null))
                    }),
                    (obj) => {
                        const result = DimensionResult.fromObject(obj);
                        const back = result.toObject();
                        
                        expect(back.key).toBe(obj.key);
                        expect(back.status).toBe(obj.status);
                    }
                ),
                { numRuns: 25 }
            );
        });
    });

    describe('ServiceMetrics', () => {
        it('should create metrics with zero counts', () => {
            const metrics = new ServiceMetrics({});
            
            expect(metrics.filled).toBe(0);
            expect(metrics.skipped).toBe(0);
            expect(metrics.failed).toBe(0);
            expect(metrics.getTotal()).toBe(0);
        });

        it('should calculate total from dimensions', () => {
            const dimensions = [
                new DimensionResult({ key: '1', status: 'filled' }),
                new DimensionResult({ key: '2', status: 'filled' }),
                new DimensionResult({ key: '3', status: 'skipped' }),
                new DimensionResult({ key: '4', status: 'failed' })
            ];
            
            const metrics = ServiceMetrics.fromDimensions(dimensions);
            
            expect(metrics.filled).toBe(2);
            expect(metrics.skipped).toBe(1);
            expect(metrics.failed).toBe(1);
            expect(metrics.getTotal()).toBe(4);
        });
    });

    describe('ServiceResult', () => {
        it('should determine status based on dimensions', () => {
            const success = new ServiceResult({
                service_name: 'EC2',
                human_label: 'EC2',
                dimensions: [
                    new DimensionResult({ key: '1', status: 'filled' }),
                    new DimensionResult({ key: '2', status: 'filled' })
                ]
            });
            
            const partial = new ServiceResult({
                service_name: 'EC2',
                human_label: 'EC2',
                dimensions: [
                    new DimensionResult({ key: '1', status: 'filled' }),
                    new DimensionResult({ key: '2', status: 'skipped' })
                ]
            });
            
            const failed = new ServiceResult({
                service_name: 'EC2',
                human_label: 'EC2',
                dimensions: [
                    new DimensionResult({ key: '1', status: 'filled' }),
                    new DimensionResult({ key: '2', status: 'failed' })
                ]
            });
            
            expect(success.determineStatus()).toBe('success');
            expect(partial.determineStatus()).toBe('partial_success');
            expect(failed.determineStatus()).toBe('failed');
        });

        it('should update status when adding dimensions', () => {
            const result = new ServiceResult({
                service_name: 'EC2',
                human_label: 'EC2'
            });
            
            expect(result.status).toBe('success');
            
            result.addDimension(new DimensionResult({ key: '1', status: 'filled' }));
            expect(result.status).toBe('success');
            
            result.addDimension(new DimensionResult({ key: '2', status: 'failed' }));
            expect(result.status).toBe('failed');
        });
    });

    describe('GroupResult', () => {
        it('should determine status based on services', () => {
            const success = new GroupResult({
                group_name: 'Production',
                services: [
                    new ServiceResult({ service_name: 'EC2', human_label: 'EC2', status: 'success' }),
                    new ServiceResult({ service_name: 'S3', human_label: 'S3', status: 'success' })
                ]
            });
            
            const partial = new GroupResult({
                group_name: 'Production',
                services: [
                    new ServiceResult({ service_name: 'EC2', human_label: 'EC2', status: 'success' }),
                    new ServiceResult({ service_name: 'S3', human_label: 'S3', status: 'partial_success' })
                ]
            });
            
            const failed = new GroupResult({
                group_name: 'Production',
                services: [
                    new ServiceResult({ service_name: 'EC2', human_label: 'EC2', status: 'success' }),
                    new ServiceResult({ service_name: 'S3', human_label: 'S3', status: 'failed' })
                ]
            });
            
            expect(success.determineStatus()).toBe('success');
            expect(partial.determineStatus()).toBe('partial_success');
            expect(failed.determineStatus()).toBe('failed');
        });

        it('should update status when adding services', () => {
            const result = new GroupResult({ group_name: 'Production' });
            
            result.addService(new ServiceResult({ service_name: 'EC2', human_label: 'EC2', status: 'success' }));
            expect(result.status).toBe('success');
            
            result.addService(new ServiceResult({ service_name: 'S3', human_label: 'S3', status: 'failed' }));
            expect(result.status).toBe('failed');
        });
    });

    describe('RunResult', () => {
        it('should create a run result with default values', () => {
            const now = new Date().toISOString();
            const result = new RunResult({
                run_id: 'run_20260226_120000',
                profile_name: 'test-profile',
                timestamp_start: now,
                timestamp_end: now
            });
            
            expect(result.schema_version).toBe('2.0');
            expect(result.status).toBe('success');
            expect(result.calculator_url).toBe('https://calculator.aws/#/estimate');
        });

        it('should determine status based on groups', () => {
            const now = new Date().toISOString();
            
            const success = new RunResult({
                run_id: 'run_1',
                profile_name: 'test',
                timestamp_start: now,
                timestamp_end: now,
                groups: [
                    new GroupResult({ group_name: 'G1', status: 'success' }),
                    new GroupResult({ group_name: 'G2', status: 'success' })
                ]
            });
            
            const partial = new RunResult({
                run_id: 'run_2',
                profile_name: 'test',
                timestamp_start: now,
                timestamp_end: now,
                groups: [
                    new GroupResult({ group_name: 'G1', status: 'success' }),
                    new GroupResult({ group_name: 'G2', status: 'partial_success' })
                ]
            });
            
            const failed = new RunResult({
                run_id: 'run_3',
                profile_name: 'test',
                timestamp_start: now,
                timestamp_end: now,
                groups: [
                    new GroupResult({ group_name: 'G1', status: 'success' }),
                    new GroupResult({ group_name: 'G2', status: 'failed' })
                ]
            });
            
            expect(success.determineStatus()).toBe('success');
            expect(partial.determineStatus()).toBe('partial_success');
            expect(failed.determineStatus()).toBe('failed');
        });

        it('should calculate total services and dimensions', () => {
            const now = new Date().toISOString();
            
            const result = new RunResult({
                run_id: 'run_1',
                profile_name: 'test',
                timestamp_start: now,
                timestamp_end: now,
                groups: [
                    new GroupResult({
                        group_name: 'G1',
                        services: [
                            new ServiceResult({
                                service_name: 'EC2',
                                human_label: 'EC2',
                                dimensions: [
                                    new DimensionResult({ key: '1', status: 'filled' }),
                                    new DimensionResult({ key: '2', status: 'filled' })
                                ]
                            }),
                            new ServiceResult({
                                service_name: 'S3',
                                human_label: 'S3',
                                dimensions: [
                                    new DimensionResult({ key: '1', status: 'filled' })
                                ]
                            })
                        ]
                    }),
                    new GroupResult({
                        group_name: 'G2',
                        services: [
                            new ServiceResult({
                                service_name: 'Lambda',
                                human_label: 'Lambda',
                                dimensions: [
                                    new DimensionResult({ key: '1', status: 'filled' }),
                                    new DimensionResult({ key: '2', status: 'filled' }),
                                    new DimensionResult({ key: '3', status: 'filled' })
                                ]
                            })
                        ]
                    })
                ]
            });
            
            expect(result.getTotalServices()).toBe(3);
            expect(result.getTotalDimensions()).toBe(6);
        });

        it('should convert to object and back (round-trip)', () => {
            const now = new Date().toISOString();
            
            fc.assert(
                fc.property(
                    fc.record({
                        run_id: fc.string().filter(s => s.length > 0),
                        profile_name: fc.string().filter(s => s.length > 0),
                        timestamp_start: fc.constant(now),
                        timestamp_end: fc.constant(now),
                        calculator_url: fc.oneof(fc.string(), fc.constant('https://calculator.aws/#/estimate'))
                    }),
                    (obj) => {
                        const result = new RunResult(obj);
                        const back = RunResult.fromObject(result.toObject());
                        
                        expect(back.run_id).toBe(obj.run_id);
                        expect(back.profile_name).toBe(obj.profile_name);
                        expect(back.calculator_url).toBe(obj.calculator_url);
                    }
                ),
                { numRuns: 25 }
            );
        });
    });
});
